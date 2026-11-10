import { readSyncDatabaseStatus } from "@cueloop/sync/database/status";
import { initializeSyncDatabase, activateSyncDatabase } from "@cueloop/sync/database/initialize";
import { createSyncDraftStore } from "@cueloop/sync/drafts";
import * as v from "valibot";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import {
  sharedCommentOperations,
  sharedExecutionOperations,
  sharedWorkspaceMutators,
} from "../../examples/sync-workspace/shared-workspace.ts";
import { createSharedTextEditorSession } from "../../examples/sync-workspace/text-editor-client.ts";
import { lookupSharedOperationReceipt } from "../../examples/sync-workspace/operation-receipt-client.ts";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { createSyncExecutionQueue } from "@cueloop/sync/execution/http";
import { submitSyncOperation } from "@cueloop/sync/operations";
import { SyncAuthorityRecoveryRequired } from "@cueloop/sync/authority";
import { waitForTestTextEditor } from "../helpers/sync-text-editor";
import { expect, test } from "bun:test";
import postgres from "postgres";
import { join } from "node:path";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createSyncBackup } from "@cueloop/sync/backup";
import { restoreSyncBackup, activateSyncRestore, fenceSyncAuthority } from "@cueloop/sync/restore";
import { migrateSyncDatabase } from "@cueloop/sync/migrations";
import { createTestSyncStack } from "../helpers/sync-stack";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a consistent backup restores canonical state into an offline generation and fails closed on migration errors",
  async () => {
    const stack = await createTestSyncStack();
    const source = postgres(stack.environment.SYNC_DATABASE_URL);
    const destinationURL = new URL(stack.environment.SYNC_DATABASE_URL);

    destinationURL.pathname = "/sync_restore";
    const destination = postgres(destinationURL.href);
    const tools = (database: string) => ({
      dump: [
        "docker",
        "exec",
        "-i",
        stack.postgresContainer,
        "env",
        `PGDATABASE=${database}`,
        "PGUSER=sync_test",
        "pg_dump",
      ],
      restore: [
        "docker",
        "exec",
        "-i",
        stack.postgresContainer,
        "env",
        `PGDATABASE=${database}`,
        "PGUSER=sync_test",
        "pg_restore",
      ],
    });

    try {
      await source.unsafe("CREATE DATABASE sync_restore");
      expect(await readSyncDatabaseStatus(destinationURL.href)).toEqual({
        status: "uninitialized",
        ready: false,
      });
      const backup = await createSyncBackup({
        databaseURL: stack.environment.SYNC_DATABASE_URL,
        directory: join(stack.directory, "backup"),
        tools: tools("sync_test"),
      });

      expect(backup.manifest.authority.generation).toBeString();
      await source`UPDATE public.shared_record SET content = 'Accepted after the snapshot'`;
      const restored = await restoreSyncBackup({
        databaseURL: destinationURL.href,
        directory: backup.directory,
        tools: tools("sync_restore"),
      });

      expect(restored.authority.authorityIdentifier).toBe(
        backup.manifest.authority.authorityIdentifier,
      );
      expect(restored.authority.generation).not.toBe(backup.manifest.authority.generation);
      expect((await destination`SELECT content FROM shared_record`)[0]?.content).toBe(
        "Shared workspace",
      );
      expect((await destination`SELECT phase FROM sync_authority`)[0]?.phase).toBe("recovering");
      await expect(
        activateSyncDatabase({
          databaseURL: destinationURL.href,
          authority: restored.authority,
          verifyReplica: async () => {
            throw new Error("Initial activation must not verify a restored deployment");
          },
        }),
      ).rejects.toThrow("without a restored source");
      const damaged = join(stack.directory, "damaged-backup");

      await mkdir(damaged, { mode: 0o700 });
      await copyFile(join(backup.directory, "application.dump"), join(damaged, "application.dump"));
      await writeFile(
        join(damaged, "manifest.json"),
        await readFile(join(backup.directory, "manifest.json")),
      );
      await appendFile(join(damaged, "application.dump"), "damaged");
      await expect(
        restoreSyncBackup({
          databaseURL: destinationURL.href,
          directory: damaged,
          tools: tools("sync_restore"),
        }),
      ).rejects.toThrow("archive digest");

      await expect(
        activateSyncRestore({
          databaseURL: destinationURL.href,
          sourceDatabaseURL: stack.environment.SYNC_DATABASE_URL,
          source: restored.source,
          authority: restored.authority,
          verifyReplica: async () => {},
        }),
      ).rejects.toThrow("source fence");
      const migration = join(stack.directory, "migration.sql");

      await writeFile(
        migration,
        "CREATE TABLE restore_migration_probe (id uuid PRIMARY KEY); SELECT missing_migration_function();",
      );
      await expect(
        migrateSyncDatabase({
          databaseURL: destinationURL.href,
          migrations: [{ identity: "test/failing-migration", path: migration }],
        }),
      ).rejects.toThrow();
      expect(
        (
          await destination`SELECT to_regclass('public.restore_migration_probe')::text AS relation`
        )[0]?.relation,
      ).toBeNull();
      expect((await destination`SELECT phase FROM sync_authority`)[0]?.phase).toBe("recovering");
      expect(await destination`SELECT identity FROM sync_schema_migration`).toHaveLength(0);
      await source.unsafe("CREATE DATABASE sync_initialized");
      const initializedURL = new URL(stack.environment.SYNC_DATABASE_URL);

      initializedURL.pathname = "/sync_initialized";
      const initialized = await initializeSyncDatabase({ databaseURL: initializedURL.href });
      const initializedDatabase = postgres(initializedURL.href);

      try {
        expect(initialized.status).toBe("recovering");
        expect(await initializedDatabase`SELECT identity FROM sync_schema_migration`).toHaveLength(
          4,
        );
        await writeFile(migration, "CREATE TABLE initial_migration_probe (id uuid PRIMARY KEY);");
        await migrateSyncDatabase({
          databaseURL: initializedURL.href,
          migrations: [{ identity: "test/initial-migration", path: migration }],
        });
        await writeFile(
          migration,
          "ALTER TABLE initial_migration_probe ADD COLUMN unexpected text;",
        );
        await expect(
          migrateSyncDatabase({
            databaseURL: initializedURL.href,
            migrations: [{ identity: "test/initial-migration", path: migration }],
          }),
        ).rejects.toThrow("applied digest");
        const escaping = join(stack.directory, "escaping-migration.sql");

        await writeFile(
          escaping,
          "CREATE TABLE escaped_migration_probe (id uuid PRIMARY KEY); COMMIT; SELECT missing_migration_function();",
        );
        await expect(
          migrateSyncDatabase({
            databaseURL: initializedURL.href,
            migrations: [{ identity: "test/escaping-migration", path: escaping }],
          }),
        ).rejects.toThrow();
        expect(
          (
            await initializedDatabase`SELECT to_regclass('public.escaped_migration_probe')::text AS relation`
          )[0]?.relation,
        ).toBeNull();
        expect((await initializedDatabase`SELECT phase FROM sync_authority`)[0]?.phase).toBe(
          "recovering",
        );
        expect(
          await initializedDatabase`SELECT column_name FROM information_schema.columns WHERE table_name = 'initial_migration_probe' AND column_name = 'unexpected'`,
        ).toHaveLength(0);
      } finally {
        await initializedDatabase.end();
      }
      await fenceSyncAuthority({
        databaseURL: stack.environment.SYNC_DATABASE_URL,
        authority: restored.source,
      });
      await expect(
        activateSyncRestore({
          databaseURL: destinationURL.href,
          sourceDatabaseURL: stack.environment.SYNC_DATABASE_URL,
          source: restored.source,
          authority: restored.authority,
          verifyReplica: async () => {
            throw new Error("Fresh replica hydration failed");
          },
        }),
      ).rejects.toThrow("hydration failed");
      expect((await destination`SELECT phase FROM sync_authority`)[0]?.phase).toBe("recovering");
      expect((await source`SELECT content FROM shared_record`)[0]?.content).toBe(
        "Accepted after the snapshot",
      );
    } finally {
      await destination.end();
      await source.end();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "fresh replicas retain known receipts, quarantine copied intent, and expose unknown requests beyond the restored snapshot",
  async () => {
    const stack = await createTestSyncStack({ interceptMutations: true });
    const source = postgres(stack.environment.SYNC_DATABASE_URL);
    const persistentStorage = createSyncSqliteStorage({
      directory: join(stack.directory, "persistent-consumer"),
    });
    const openedStores: string[] = [];
    const storage = {
      create(name: string) {
        openedStores.push(name);

        return persistentStorage.create(name);
      },
      drop: persistentStorage.drop,
    };
    const client = createSharedRecordClient({ ...stack, storage, storageKey: "stable-consumer" });
    const drafts = createSyncDraftStore({
      storage,
      authorityIdentifier: "restore-test",
      userIdentifier: stack.userID,
    });
    let target: Awaited<ReturnType<typeof createTestSyncStack>> | undefined;
    let recoveredClient: ReturnType<typeof createSharedRecordClient> | undefined;
    let editor: Awaited<ReturnType<typeof createSharedTextEditorSession>> | undefined;

    try {
      const [record] = await client.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Backup receipt test requires its source record");

      const known = sharedCommentOperations.add.create({
        authority: stack.authority,
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, body: "Included in the snapshot" },
      });
      const unknown = sharedCommentOperations.add.create({
        authority: stack.authority,
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: { recordIdentifier: record.id, body: "Accepted beyond the snapshot" },
      });
      const draft = await drafts.save({ content: unknown.arguments });

      await drafts.markSubmitted({ draftIdentifier: draft.draftIdentifier, operation: unknown });
      const knownReceipt = await submitSyncOperation({
        operation: known,
        submit: (operation) => client.mutate(sharedWorkspaceMutators.comment.add(operation)),
      });

      expect(knownReceipt.status).toBe("accepted");

      if (knownReceipt.status !== "accepted")
        throw new Error("Backup receipt test requires an accepted source request");

      editor = await createSharedTextEditorSession({
        ...stack,
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
        storage: createSyncSqliteStorage({ directory: join(stack.directory, "text-drafts") }),
      });
      await waitForTestTextEditor(
        editor,
        (snapshot) => snapshot.connection === "connected",
        "the source backup text editor",
      );
      editor.change("Text and history included in the snapshot");
      expect((await editor.save()).status).toBe("accepted");
      const intent = sharedExecutionOperations.request.create({
        authority: stack.authority,
        workspaceIdentifier: record.workspaceIdentifier,
        arguments: {
          recordIdentifier: record.id,
          text: "Durable intent requires provider recovery",
        },
      });

      expect(
        (
          await submitSyncOperation({
            operation: intent,
            submit: (operation) =>
              client.mutate(sharedWorkspaceMutators.execution.request(operation)),
            lookup: (operation) => lookupSharedOperationReceipt({ ...stack, operation }),
          })
        ).status,
      ).toBe("accepted");
      const backup = await createSyncBackup({
        databaseURL: stack.environment.SYNC_DATABASE_URL,
        directory: join(stack.directory, "complete-backup"),
        tools: {
          dump: [
            "docker",
            "exec",
            "-i",
            stack.postgresContainer,
            "env",
            "PGDATABASE=sync_test",
            "PGUSER=sync_test",
            "pg_dump",
          ],
          restore: ["docker", "exec", "-i", stack.postgresContainer, "pg_restore"],
        },
      });

      const lost = stack.pauseNextMutation();
      const uncertain = submitSyncOperation({
        operation: unknown,
        acknowledgementTimeoutMilliseconds: 1000,
        submit: (operation) => client.mutate(sharedWorkspaceMutators.comment.add(operation)),
      });

      await lost.received;
      lost.forward();
      await lost.processed;
      await client.close();
      expect((await uncertain).status).toBe("pending");
      const storesBeforeRecovery = openedStores.length;
      const originalReplicaStores = new Set(
        openedStores.filter((name) => name.includes(`zero-${stack.userID}-`)),
      );

      target = await createTestSyncStack({ restoreDirectory: backup.directory });

      if (!target.recovery)
        throw new Error("Backup recovery fixture requires its restored boundary");

      const recoveredDatabase = postgres(target.environment.SYNC_DATABASE_URL);

      try {
        recoveredClient = createSharedRecordClient({
          ...target,
          storage,
          storageKey: "stable-consumer",
        });
        const [retained] = await drafts.list();

        if (retained?.status !== "pending")
          throw new Error("Backup recovery must retain the uncertain pending draft");

        expect(retained.operation).toEqual(unknown);
        expect(target.replica.appID).not.toBe(stack.replica.appID);
        await fenceSyncAuthority({
          databaseURL: stack.environment.SYNC_DATABASE_URL,
          authority: stack.authority,
        });
        const activated = await activateSyncRestore({
          databaseURL: target.environment.SYNC_DATABASE_URL,
          sourceDatabaseURL: stack.environment.SYNC_DATABASE_URL,
          source: target.recovery.source,
          authority: target.recovery.authority,
          verifyReplica: async (configuration) => {
            expect(configuration.appID).toBe(target!.replica.appID);
            const [hydrated] = await recoveredClient!.run(sharedRecordQueries.records(), {
              type: "complete",
            });

            expect(hydrated?.content).toBe("Text and history included in the snapshot");
          },
        });

        expect(activated.status).toBe("active");
        expect(
          await activateSyncRestore({
            databaseURL: target.environment.SYNC_DATABASE_URL,
            sourceDatabaseURL: "postgres://unused:unused@127.0.0.1:1/unreachable",
            source: target.recovery.source,
            authority: target.recovery.authority,
            verifyReplica: async () => {
              throw new Error("An acknowledged activation must not repeat replica verification");
            },
          }),
        ).toEqual(activated);
        expect(
          await restoreSyncBackup({
            databaseURL: target.environment.SYNC_DATABASE_URL,
            directory: backup.directory,
          }),
        ).toMatchObject({ status: "active", authority: activated.authority });
        const replacementStores = openedStores
          .slice(storesBeforeRecovery)
          .filter((name) => name.includes(`zero-${stack.userID}-`));

        expect(originalReplicaStores.size).toBeGreaterThan(0);
        expect(replacementStores.length).toBeGreaterThan(0);
        expect(replacementStores.some((name) => originalReplicaStores.has(name))).toBe(false);
        expect(await lookupSharedOperationReceipt({ ...target, operation: known })).toEqual(
          knownReceipt,
        );
        await expect(
          lookupSharedOperationReceipt({ ...target, operation: unknown }),
        ).rejects.toBeInstanceOf(SyncAuthorityRecoveryRequired);
        expect(
          (
            await submitSyncOperation({
              operation: unknown,
              submit: (operation) =>
                recoveredClient!.mutate(sharedWorkspaceMutators.comment.add(operation)),
            })
          ).status,
        ).toBe("recovery-required");
        expect(
          await recoveredDatabase`SELECT id FROM shared_comment WHERE id = ${unknown.operationIdentifier}`,
        ).toHaveLength(0);
        expect(
          await source`SELECT id FROM shared_comment WHERE id = ${unknown.operationIdentifier}`,
        ).toHaveLength(1);
        expect(
          (await recoveredDatabase`SELECT count(*)::integer AS count FROM shared_text_revision`)[0]
            ?.count,
        ).toBeGreaterThan(0);
        expect(
          (
            await recoveredDatabase`SELECT recovery_held, executor_identifier FROM sync_execution WHERE id = ${intent.operationIdentifier}`
          )[0],
        ).toEqual({ recovery_held: true, executor_identifier: null });
        const queue = createSyncExecutionQueue({
          url: new URL("execution", target.authorityURL).href,
          workspaceIdentifier: record.workspaceIdentifier,
          headers: () => ({ authorization: `Bearer ${target!.auth}` }),
        });

        expect(await queue.claim({ executorIdentifier: crypto.randomUUID() })).toBeNull();
        const fresh = sharedCommentOperations.add.create({
          authority: target.authority,
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: {
            recordIdentifier: record.id,
            body: "A new request in the recovered generation",
          },
        });

        expect(
          (
            await submitSyncOperation({
              operation: fresh,
              submit: (operation) =>
                recoveredClient!.mutate(sharedWorkspaceMutators.comment.add(operation)),
            })
          ).status,
        ).toBe("accepted");
      } finally {
        await recoveredDatabase.end();
      }
    } finally {
      await editor?.close();
      await recoveredClient?.close();
      await client.close();
      await drafts.close();
      await source.end();
      await target?.close();
      await stack.close();
    }
  },
  180000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "terminating a restore backend rolls back its schema and leaves the active source unchanged",
  async () => {
    const stack = await createTestSyncStack();
    const source = postgres(stack.environment.SYNC_DATABASE_URL, { onnotice: () => {} });
    const destinationURL = new URL(stack.environment.SYNC_DATABASE_URL);

    destinationURL.pathname = "/sync_interrupted";
    const destination = postgres(destinationURL.href, { onnotice: () => {} });

    try {
      await source
        .unsafe(
          "CREATE FUNCTION sync_test_restore_gate() RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(852981); RETURN true; END $$; CREATE TABLE sync_test_restore_probe (id uuid PRIMARY KEY DEFAULT uuidv7(), ready boolean NOT NULL CHECK (sync_test_restore_gate())); INSERT INTO sync_test_restore_probe (ready) VALUES (true);",
        )
        .simple();
      await source.unsafe("CREATE DATABASE sync_interrupted");
      const backup = await createSyncBackup({
        databaseURL: stack.environment.SYNC_DATABASE_URL,
        directory: join(stack.directory, "interrupt-backup"),
        tools: {
          dump: [
            "docker",
            "exec",
            "-i",
            stack.postgresContainer,
            "env",
            "PGDATABASE=sync_test",
            "PGUSER=sync_test",
            "pg_dump",
          ],
          restore: ["docker", "exec", "-i", stack.postgresContainer, "pg_restore"],
        },
      });

      await destination.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(852981)`;
        const restore = restoreSyncBackup({
          databaseURL: destinationURL.href,
          directory: backup.directory,
          tools: {
            restore: [
              "docker",
              "exec",
              "-i",
              stack.postgresContainer,
              "env",
              "PGDATABASE=sync_interrupted",
              "PGUSER=sync_test",
              "pg_restore",
            ],
          },
        });
        const failed = restore.then(
          () => ({ failed: false }),
          () => ({ failed: true }),
        );
        const deadline = Date.now() + 15000;
        let terminated = false;

        for (;;) {
          const waiting = v.parse(
            v.array(v.object({ pid: v.number() })),
            await source`SELECT pid FROM pg_stat_activity WHERE datname = 'sync_interrupted' AND wait_event = 'advisory' AND query LIKE 'COPY %sync_test_restore_probe%'`,
          );
          const backend = waiting[0]?.pid;

          if (backend !== undefined) {
            await source`SELECT pg_terminate_backend(${backend})`;
            terminated = true;
            break;
          }

          if (Date.now() >= deadline) break;

          await Bun.sleep(20);
        }

        expect(terminated).toBe(true);
        expect(await failed).toEqual({ failed: true });
      });
      expect(
        (await destination`SELECT to_regclass('public.sync_authority')::text AS authority`)[0]
          ?.authority,
      ).toBeNull();
      expect((await source`SELECT phase FROM public.sync_authority`)[0]?.phase).toBe("active");
      expect((await source`SELECT content FROM public.shared_record`)[0]?.content).toBe(
        "Shared workspace",
      );
    } finally {
      await destination.end();
      await source.end();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "restore resumes after a lost import acknowledgement and binds the source fence to one destination",
  async () => {
    const stack = await createTestSyncStack();
    const source = postgres(stack.environment.SYNC_DATABASE_URL);
    const destinationURL = new URL(stack.environment.SYNC_DATABASE_URL);
    const otherURL = new URL(stack.environment.SYNC_DATABASE_URL);

    destinationURL.pathname = "/sync_resume";
    otherURL.pathname = "/sync_second_restore";
    const destination = postgres(destinationURL.href);
    const tools = (database: string) => ({
      dump: [
        "docker",
        "exec",
        "-i",
        stack.postgresContainer,
        "env",
        `PGDATABASE=${database}`,
        "PGUSER=sync_test",
        "pg_dump",
      ],
      restore: [
        "docker",
        "exec",
        "-i",
        stack.postgresContainer,
        "env",
        `PGDATABASE=${database}`,
        "PGUSER=sync_test",
        "pg_restore",
      ],
    });

    try {
      await source.unsafe("CREATE DATABASE sync_resume");
      await source.unsafe("CREATE DATABASE sync_second_restore");
      const backup = await createSyncBackup({
        databaseURL: stack.environment.SYNC_DATABASE_URL,
        directory: join(stack.directory, "resume-backup"),
        tools: tools("sync_test"),
      });
      const interruptedTools = {
        restore: [
          "/bin/sh",
          "-c",
          '"$@"; result=$?; if [ "$result" -eq 0 ]; then exit 71; fi; exit "$result"',
          "sync-restore-acknowledgement",
          ...tools("sync_resume").restore,
        ],
      };

      await expect(
        restoreSyncBackup({
          databaseURL: destinationURL.href,
          directory: backup.directory,
          tools: interruptedTools,
        }),
      ).rejects.toThrow("PostgreSQL tool failed");
      expect((await destination`SELECT content FROM public.shared_record`)[0]?.content).toBe(
        "Shared workspace",
      );
      expect(await destination`SELECT id FROM public.sync_authority`).toHaveLength(0);
      expect(await readSyncDatabaseStatus(destinationURL.href)).toMatchObject({
        status: "restore-pending",
        ready: false,
      });
      const resumed = await restoreSyncBackup({
        databaseURL: destinationURL.href,
        directory: backup.directory,
        tools: interruptedTools,
      });

      expect(resumed.status).toBe("recovering");
      expect(
        await restoreSyncBackup({
          databaseURL: destinationURL.href,
          directory: backup.directory,
          tools: interruptedTools,
        }),
      ).toEqual(resumed);
      const other = await restoreSyncBackup({
        databaseURL: otherURL.href,
        directory: backup.directory,
        tools: tools("sync_second_restore"),
      });

      await fenceSyncAuthority({
        databaseURL: stack.environment.SYNC_DATABASE_URL,
        authority: stack.authority,
      });
      await expect(
        activateSyncRestore({
          databaseURL: destinationURL.href,
          sourceDatabaseURL: stack.environment.SYNC_DATABASE_URL,
          source: resumed.source,
          authority: resumed.authority,
          verifyReplica: async () => {
            throw new Error("Replica proof is unavailable");
          },
        }),
      ).rejects.toThrow("proof is unavailable");
      await expect(
        activateSyncRestore({
          databaseURL: otherURL.href,
          sourceDatabaseURL: stack.environment.SYNC_DATABASE_URL,
          source: other.source,
          authority: other.authority,
          verifyReplica: async () => {
            throw new Error("A second destination must not reach replica verification");
          },
        }),
      ).rejects.toThrow("source fence bound to this destination");
      expect(await readSyncDatabaseStatus(stack.environment.SYNC_DATABASE_URL)).toMatchObject({
        status: "fenced",
        recoveryTargetGeneration: resumed.authority.generation,
      });
      expect(await readSyncDatabaseStatus(otherURL.href)).toMatchObject({
        status: "recovering",
        ready: false,
      });
      expect((await source`SELECT phase FROM public.sync_authority`)[0]?.phase).toBe("fenced");
    } finally {
      await destination.end();
      await source.end();
      await stack.close();
    }
  },
  120000,
);
