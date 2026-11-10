import type { ServerTransaction } from "@rocicorp/zero";
import { expect, test } from "bun:test";
import postgres from "postgres";
import { zeroPostgresJS } from "@rocicorp/zero/server/adapters/postgresjs";
import * as v from "valibot";
import { defineSyncOperation, createSyncRecordIdentifier } from "@cueloop/sync/operations";
import { acceptSyncOperation, findSyncOperationReceipt } from "@cueloop/sync/server";
import {
  createSyncAuthorityDatabase,
  readSyncAuthority,
  readSyncWorkspaceAuthority,
} from "@cueloop/sync/authority/server";
import { SyncAuthorityFenced, SyncAuthorityRecoveryRequired } from "@cueloop/sync/authority";
import {
  claimSyncExecution,
  reportSyncExecution,
  SyncExecutionLeaseConflict,
} from "@cueloop/sync/execution/server";
import { createTestSyncStack } from "../helpers/sync-stack";
import { sharedRecordSchema } from "../../examples/sync-workspace/workspace-schema.ts";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a replacement authority generation returns known receipts and never accepts an absent old-generation request",
  async () => {
    const stack = await createTestSyncStack();
    const connection = postgres(stack.environment.SYNC_DATABASE_URL);
    const database = zeroPostgresJS(sharedRecordSchema, connection);
    const definition = defineSyncOperation({
      name: "record.append",
      version: 1,
      arguments: v.strictObject({ suffix: v.string() }),
    });

    try {
      const [record] = v.parse(
        v.array(v.object({ id: v.string(), workspace_identifier: v.string() })),
        await connection`SELECT id::text, workspace_identifier::text FROM shared_record LIMIT 1`,
      );

      if (!record) throw new Error("Authority recovery test requires its initial record");

      const sourceIdentity = await database.transaction((transaction) =>
        readSyncAuthority(transaction),
      );
      const source = createSyncAuthorityDatabase({ database, identity: sourceIdentity });
      const normalizedSource = createSyncAuthorityDatabase({
        database,
        identity: {
          authorityIdentifier: sourceIdentity.authorityIdentifier.toUpperCase(),
          generation: sourceIdentity.generation.toUpperCase(),
        },
      });

      expect(
        await normalizedSource.transaction((transaction) => readSyncAuthority(transaction)),
      ).toEqual(sourceIdentity);
      const original = await source.transaction((transaction) =>
        readSyncWorkspaceAuthority(transaction, record.workspace_identifier),
      );
      const operation = definition.create({
        workspaceIdentifier: record.workspace_identifier,
        authority: original.authority,
        arguments: { suffix: "-accepted-once" },
      });
      const unknown = definition.create({
        workspaceIdentifier: record.workspace_identifier,
        authority: original.authority,
        arguments: { suffix: "-must-not-replay" },
      });
      const accept = (
        transaction: ServerTransaction<typeof sharedRecordSchema, unknown>,
        request: typeof operation,
      ) =>
        acceptSyncOperation({
          transaction,
          definition,
          operation: request,
          actorIdentifier: stack.userID,
          authorize: async () => {},
          apply: async (applicationTransaction) => {
            await applicationTransaction.dbTransaction.query(
              "UPDATE shared_record SET content = content || $1 WHERE id = $2",
              [request.arguments.suffix, record.id],
            );

            return { applied: request.arguments.suffix };
          },
        });
      const expired = definition.create({
        workspaceIdentifier: record.workspace_identifier,
        authority: original.authority,
        arguments: { suffix: "-expired-but-unknown" },
        now: () => Date.now() - 600000,
      });
      const accepted = await source.transaction((transaction) => accept(transaction, operation));

      expect(accepted.status).toBe("accepted");
      const executionIdentifier = createSyncRecordIdentifier();
      const executorIdentifier = createSyncRecordIdentifier();

      await connection`INSERT INTO sync_execution (id, workspace_identifier, target_identifier, requester_identifier, action, input) VALUES (${executionIdentifier}, ${record.workspace_identifier}, ${record.id}, ${stack.userID}, 'agent.prompt', '{}')`;
      const oldClaim = await source.transaction((transaction) =>
        claimSyncExecution({
          transaction,
          workspaceIdentifier: record.workspace_identifier,
          actorIdentifier: stack.userID,
          executorIdentifier,
          authorize: async () => {},
        }),
      );

      if (!oldClaim)
        throw new Error("Authority recovery test requires its original execution claim");

      await connection`UPDATE sync_execution SET recovery_held = true, lease_expires_at = NULL WHERE id = ${executionIdentifier}`;
      await connection`UPDATE sync_authority SET generation = ${createSyncRecordIdentifier()}`;
      const restoredIdentity = await database.transaction((transaction) =>
        readSyncAuthority(transaction),
      );
      const restored = createSyncAuthorityDatabase({ database, identity: restoredIdentity });

      expect(
        await restored.transaction((transaction) =>
          claimSyncExecution({
            transaction,
            workspaceIdentifier: record.workspace_identifier,
            actorIdentifier: stack.userID,
            executorIdentifier,
            authorize: async () => {},
          }),
        ),
      ).toBeNull();
      await expect(
        restored.transaction((transaction) =>
          reportSyncExecution({
            transaction,
            workspaceIdentifier: record.workspace_identifier,
            actorIdentifier: stack.userID,
            authorize: async () => {},
            report: { claim: oldClaim, observation: { status: "completed" } },
          }),
        ),
      ).rejects.toBeInstanceOf(SyncExecutionLeaseConflict);
      expect(await restored.transaction((transaction) => accept(transaction, operation))).toEqual(
        accepted,
      );
      await expect(
        restored.transaction((transaction) => accept(transaction, unknown)),
      ).rejects.toBeInstanceOf(SyncAuthorityRecoveryRequired);
      await expect(
        restored.transaction((transaction) =>
          findSyncOperationReceipt({
            transaction,
            definition,
            operation: unknown,
            actorIdentifier: stack.userID,
            authorize: async () => {},
          }),
        ),
      ).rejects.toBeInstanceOf(SyncAuthorityRecoveryRequired);
      await expect(
        restored.transaction((transaction) => accept(transaction, expired)),
      ).rejects.toBeInstanceOf(SyncAuthorityRecoveryRequired);
      await expect(
        source.transaction((transaction) => accept(transaction, operation)),
      ).rejects.toBeInstanceOf(SyncAuthorityFenced);
      const rows = await connection`SELECT content FROM shared_record WHERE id = ${record.id}`;

      expect(rows[0]?.content).toBe("Shared workspace-accepted-once");
      const receipts = await connection`SELECT operation_identifier FROM sync_operation_receipt`;

      expect(receipts).toHaveLength(1);
    } finally {
      await connection.end();
      await stack.close();
    }
  },
  120000,
);
