import { waitForTestSyncState } from "../helpers/sync-test-deadline";
import {
  runTestSyncWorkspaceCli,
  createTestSyncTransferApplication,
} from "../helpers/sync-workspace-cli";
import { expect, test } from "bun:test";
import postgres from "postgres";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { v7 as uuidv7 } from "uuid";
import {
  prepareSyncWorkspaceTransfer,
  importSyncWorkspaceTransfer,
  activateSyncWorkspaceTransfer,
  readSyncWorkspaceTransfer,
  createSyncWorkspaceTransferBinding,
} from "@cueloop/sync/transfer";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import { sharedCommentOperations } from "../../examples/sync-workspace/shared-comment.ts";
import { editSharedRecord } from "../../examples/sync-workspace/shared-record-edit-client.ts";
import { sharedWorkspaceMutators } from "../../examples/sync-workspace/shared-workspace.ts";
import { sharedWorkspaceTransferAdapter as adapter } from "../../examples/sync-workspace/workspace-transfer.ts";
import { lookupSharedOperationReceipt } from "../../examples/sync-workspace/operation-receipt-client.ts";
import { submitSyncOperation } from "@cueloop/sync/operations";

// Run only with the opt-in real PostgreSQL and Zero compatibility tier.
test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "workspace handoffs resume after failures, preserve unrelated workspaces, and transfer back through fresh authority generations",
  async () => {
    const source = await createTestSyncStack();
    let target: Awaited<ReturnType<typeof createTestSyncStack>> | undefined;
    const sourceDatabase = postgres(source.environment.SYNC_DATABASE_URL);
    const sourceClient = createSharedRecordClient(source);
    const opened: ReturnType<typeof createSharedRecordClient>[] = [];

    try {
      target = await createTestSyncStack();
      const targetDatabase = postgres(target.environment.SYNC_DATABASE_URL);
      const targetClient = createSharedRecordClient(target);

      opened.push(targetClient);

      try {
        const [record] = await sourceClient.run(sharedRecordQueries.records(), {
          type: "complete",
        });
        const [unrelated] = await targetClient.run(sharedRecordQueries.records(), {
          type: "complete",
        });

        if (!record || !unrelated)
          throw new Error("Transfer fixture requires source and unrelated target records");

        const known = sharedCommentOperations.add.create({
          authority: source.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { recordIdentifier: record.id, body: "Accepted before workspace transfer" },
        });
        const receipt = await submitSyncOperation({
          operation: known,
          submit: (operation) =>
            sourceClient.mutate(sharedWorkspaceMutators.comment.add(operation)),
        });

        expect(receipt.status).toBe("accepted");

        if (receipt.status !== "accepted")
          throw new Error("Transfer requires the accepted source receipt");

        await editSharedRecord({
          ...source,
          client: sourceClient,
          workspaceIdentifier: record.workspaceIdentifier,
          recordIdentifier: record.id,
          content: "Before the committing writer drains",
        });
        const binding = createSyncWorkspaceTransferBinding({
          source: source.authority,
          target: target.authority,
          adapter,
        });
        const targetAuthority = binding.target;
        const directory = join(source.directory, "missing-parent", "workspace");
        const application = await createTestSyncTransferApplication(source.directory);
        const bindingPath = join(source.directory, "handoff.json");

        await writeFile(bindingPath, JSON.stringify(binding), { mode: 0o600 });

        await sourceDatabase`INSERT INTO sync_schema_migration (identity, digest) VALUES ('test/workspace-transfer', ${"a".repeat(64)})`;
        await targetDatabase`INSERT INTO sync_schema_migration (identity, digest) VALUES ('test/workspace-transfer', ${"b".repeat(64)})`;
        const executionIdentifier = uuidv7();
        const executorIdentifier = crypto.randomUUID();
        const leaseIdentifier = crypto.randomUUID();

        await sourceDatabase`INSERT INTO sync_execution (id, workspace_identifier, target_identifier, requester_identifier, action, input, status, executor_identifier, lease_identifier, fencing_token, lease_generation, lease_expires_at, observation_reference, created_at) VALUES (${executionIdentifier}, ${record.workspaceIdentifier}, ${record.id}, ${source.userID}, 'test.precision', '{"large":9007199254740993123,"decimal":0.1234567890123456789}'::jsonb, 'executing', ${executorIdentifier}, ${leaseIdentifier}, 7, ${source.authority.generation}, now() + interval '1 hour', 'provider-operation-reference', '2026-11-10 12:00:00.123456+00')`;
        const [originalExecution] =
          await sourceDatabase`SELECT input::text, created_at::text FROM sync_execution WHERE id = ${executionIdentifier}`;

        const writerReady = Promise.withResolvers<void>();
        const releaseWriter = Promise.withResolvers<void>();
        const writer = sourceDatabase.begin(async (transaction) => {
          await transaction`SELECT id FROM sync_authority WHERE singleton FOR SHARE`;
          await transaction`SELECT id FROM sync_workspace_authority WHERE workspace_identifier = ${record.workspaceIdentifier} FOR SHARE`;
          writerReady.resolve();
          await releaseWriter.promise;
          await transaction`UPDATE shared_record SET content = 'Accepted before workspace transfer' WHERE id = ${record.id}`;
        });

        await writerReady.promise;
        const preparing = prepareSyncWorkspaceTransfer({
          databaseURL: source.environment.SYNC_DATABASE_URL,
          directory,
          binding,
          adapter,
        }).then(
          () => undefined,
          (cause: Error) => cause,
        );

        try {
          await waitForTestSyncState(
            (async () => {
              for (;;) {
                const [blocked] =
                  await sourceDatabase`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM public.sync_workspace_authority%' AND query LIKE '%FOR UPDATE%'`;

                if (blocked?.count > 0) return;
              }
            })(),
            "the transfer fence to wait for its committing writer",
          );
        } finally {
          releaseWriter.resolve();
          await writer;
        }

        expect(await preparing).toBeInstanceOf(Error);
        expect(
          await readSyncWorkspaceTransfer({
            databaseURL: source.environment.SYNC_DATABASE_URL,
            workspaceIdentifier: record.workspaceIdentifier,
          }),
        ).toMatchObject({ phase: "fenced", binding });
        expect(
          (
            await sourceDatabase`SELECT phase FROM sync_workspace_authority WHERE workspace_identifier = ${record.workspaceIdentifier}`
          )[0]?.phase,
        ).toBe("fenced");
        await mkdir(join(source.directory, "missing-parent"));
        const exported = await prepareSyncWorkspaceTransfer({
          databaseURL: source.environment.SYNC_DATABASE_URL,
          directory,
          binding,
          adapter,
        });

        expect(exported.manifest.rowCount).toBeGreaterThan(0);
        expect(
          await runTestSyncWorkspaceCli(
            [
              "prepare",
              "--binding",
              bindingPath,
              "--directory",
              directory,
              "--application",
              application,
            ],
            source.environment,
          ),
        ).toEqual(exported);
        expect(
          await prepareSyncWorkspaceTransfer({
            databaseURL: source.environment.SYNC_DATABASE_URL,
            directory,
            binding,
            adapter,
          }),
        ).toEqual(exported);
        const blocked = sharedCommentOperations.add.create({
          authority: source.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { recordIdentifier: record.id, body: "Old source must not write" },
        });

        expect(
          (await sourceClient.mutate(sharedWorkspaceMutators.comment.add(blocked)).server).type,
        ).toBe("error");
        expect(
          (await sourceDatabase`SELECT content FROM shared_record WHERE id = ${record.id}`)[0]
            ?.content,
        ).toBe("Accepted before workspace transfer");
        await expect(
          importSyncWorkspaceTransfer({
            databaseURL: target.environment.SYNC_DATABASE_URL,
            sourceDatabaseURL: source.environment.SYNC_DATABASE_URL,
            directory,
            adapter,
          }),
        ).rejects.toThrow("migration ledger is incompatible");
        expect(
          await targetDatabase`SELECT id FROM shared_record WHERE id = ${record.id}`,
        ).toHaveLength(0);
        await targetDatabase`UPDATE sync_schema_migration SET digest = ${"a".repeat(64)} WHERE identity = 'test/workspace-transfer'`;
        await expect(
          importSyncWorkspaceTransfer({
            databaseURL: target.environment.SYNC_DATABASE_URL,
            sourceDatabaseURL: source.environment.SYNC_DATABASE_URL,
            directory,
            adapter: {
              ...adapter,
              verifyImport: async () => {
                throw new Error("Injected import interruption");
              },
            },
          }),
        ).rejects.toThrow("Injected import interruption");
        expect(
          await targetDatabase`SELECT id FROM shared_record WHERE id = ${record.id}`,
        ).toHaveLength(0);
        expect(
          await readSyncWorkspaceTransfer({
            databaseURL: target.environment.SYNC_DATABASE_URL,
            workspaceIdentifier: record.workspaceIdentifier,
          }),
        ).toBeUndefined();
        const imported = await importSyncWorkspaceTransfer({
          databaseURL: target.environment.SYNC_DATABASE_URL,
          sourceDatabaseURL: source.environment.SYNC_DATABASE_URL,
          directory,
          adapter,
        });

        expect(imported.status).toBe("imported");
        expect(
          (
            await targetDatabase`SELECT input::text, created_at::text FROM sync_execution WHERE id = ${executionIdentifier}`
          )[0],
        ).toEqual(originalExecution);
        expect(
          (
            await targetDatabase`SELECT recovery_held, executor_identifier::text, lease_identifier::text, fencing_token, lease_generation, lease_expires_at, observation_reference FROM sync_execution WHERE id = ${executionIdentifier}`
          )[0],
        ).toEqual({
          recovery_held: true,
          executor_identifier: executorIdentifier,
          lease_identifier: leaseIdentifier,
          fencing_token: 7,
          lease_generation: null,
          lease_expires_at: null,
          observation_reference: "provider-operation-reference",
        });
        expect(
          await runTestSyncWorkspaceCli(
            [
              "import",
              "--directory",
              directory,
              "--application",
              "examples/sync-workspace/authority.ts",
              "--source-database-env",
              "SOURCE_DATABASE_URL",
            ],
            { ...target.environment, SOURCE_DATABASE_URL: source.environment.SYNC_DATABASE_URL },
          ),
        ).toEqual(imported);
        expect(
          await runTestSyncWorkspaceCli(
            ["status", "--workspace", record.workspaceIdentifier],
            target.environment,
          ),
        ).toMatchObject({ phase: "imported", binding });
        expect(
          await importSyncWorkspaceTransfer({
            databaseURL: target.environment.SYNC_DATABASE_URL,
            sourceDatabaseURL: source.environment.SYNC_DATABASE_URL,
            directory,
            adapter,
          }),
        ).toEqual(imported);
        await expect(
          activateSyncWorkspaceTransfer({
            databaseURL: target.environment.SYNC_DATABASE_URL,
            sourceDatabaseURL: source.environment.SYNC_DATABASE_URL,
            binding,
            verifyReplica: async () => {
              throw new Error("Replica unavailable");
            },
          }),
        ).rejects.toThrow("Replica unavailable");
        expect(
          (
            await targetDatabase`SELECT phase FROM sync_workspace_authority WHERE workspace_identifier = ${record.workspaceIdentifier}`
          )[0]?.phase,
        ).toBe("fenced");
        const destination = createSharedRecordClient({ ...target, authority: targetAuthority });

        opened.push(destination);
        const activation = await runTestSyncWorkspaceCli(
          [
            "activate",
            "--binding",
            bindingPath,
            "--source-database-env",
            "SOURCE_DATABASE_URL",
            "--application",
            application,
          ],
          {
            ...target.environment,
            SOURCE_DATABASE_URL: source.environment.SYNC_DATABASE_URL,
            SYNC_EXPECTED_RECORD: record.id,
            SYNC_EXPECTED_CONTENT: "Accepted before workspace transfer",
          },
        );

        expect(activation).toMatchObject({ status: "active", authority: targetAuthority });
        const visible = await destination.run(sharedRecordQueries.records(), { type: "complete" });

        expect(visible.find((row) => row.id === record.id)?.content).toBe(
          "Accepted before workspace transfer",
        );
        expect(visible.find((row) => row.id === unrelated.id)?.content).toBe(unrelated.content);

        expect(
          await activateSyncWorkspaceTransfer({
            databaseURL: target.environment.SYNC_DATABASE_URL,
            sourceDatabaseURL: "postgres://unused:unused@127.0.0.1:1/unreachable",
            binding,
            verifyReplica: async () => {
              throw new Error("Duplicate activation must not verify again");
            },
          }),
        ).toEqual({
          status: "active",
          authority: targetAuthority,
          transferIdentifier: binding.transferIdentifier,
        });
        expect(await lookupSharedOperationReceipt({ ...target, operation: known })).toEqual(
          receipt,
        );
        expect(
          (await targetDatabase`SELECT id::text, generation::text, phase FROM sync_authority`)[0],
        ).toEqual({
          id: target.authority.authorityIdentifier,
          generation: target.authority.generation,
          phase: "active",
        });
        expect(
          (await targetClient.run(sharedRecordQueries.records(), { type: "complete" })).find(
            (row) => row.id === unrelated.id,
          )?.content,
        ).toBe(unrelated.content);
        const changed = sharedCommentOperations.add.create({
          authority: targetAuthority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { recordIdentifier: record.id, body: "Accepted at the remote authority" },
        });

        expect(
          (
            await submitSyncOperation({
              operation: changed,
              submit: (operation) =>
                destination.mutate(sharedWorkspaceMutators.comment.add(operation)),
            })
          ).status,
        ).toBe("accepted");
        await editSharedRecord({
          ...target,
          client: destination,
          workspaceIdentifier: record.workspaceIdentifier,
          recordIdentifier: record.id,
          content: "Accepted at the remote authority",
        });
        const returning = createSyncWorkspaceTransferBinding({
          source: targetAuthority,
          target: source.authority,
          adapter,
        });
        const returnedAuthority = returning.target;
        const returningDirectory = join(target.directory, "returning-workspace");

        await prepareSyncWorkspaceTransfer({
          databaseURL: target.environment.SYNC_DATABASE_URL,
          directory: returningDirectory,
          binding: returning,
          adapter,
        });
        await importSyncWorkspaceTransfer({
          databaseURL: source.environment.SYNC_DATABASE_URL,
          sourceDatabaseURL: target.environment.SYNC_DATABASE_URL,
          directory: returningDirectory,
          adapter,
        });
        const returned = createSharedRecordClient({ ...source, authority: returnedAuthority });

        opened.push(returned);
        await activateSyncWorkspaceTransfer({
          databaseURL: source.environment.SYNC_DATABASE_URL,
          sourceDatabaseURL: target.environment.SYNC_DATABASE_URL,
          binding: returning,
          verifyReplica: async () => {
            const rows = await returned.run(sharedRecordQueries.records(), { type: "complete" });

            expect(rows.find((row) => row.id === record.id)?.content).toBe(
              "Accepted at the remote authority",
            );
          },
        });
        expect(await lookupSharedOperationReceipt({ ...source, operation: known })).toEqual(
          receipt,
        );
        expect(
          (
            await targetDatabase`SELECT phase FROM sync_workspace_authority WHERE workspace_identifier = ${record.workspaceIdentifier}`
          )[0]?.phase,
        ).toBe("fenced");
        expect(
          (await targetDatabase`SELECT content FROM shared_record WHERE id = ${unrelated.id}`)[0]
            ?.content,
        ).toBe(unrelated.content);
      } finally {
        await targetDatabase.end();
      }
    } finally {
      await Promise.all(opened.map((client) => client.close()));
      await sourceClient.close();
      await sourceDatabase.end();
      await target?.close();
      await source.close();
    }
  },
  120000,
);
