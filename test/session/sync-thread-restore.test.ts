import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSyncClient } from "@cueloop/sync";
import { createSyncBackup } from "@cueloop/sync/backup";
import { activateSyncRestore, fenceSyncAuthority } from "@cueloop/sync/restore";
import { DaemonClient } from "@cueloop/daemon/client";
import { DaemonServer } from "@cueloop/daemon";
import { syncThreadSchema } from "@cueloop/daemon/sync-thread-schema";
import { syncThreadQueries } from "@cueloop/daemon/sync-thread-queries";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createTestSyncProxy } from "../helpers/sync-proxy";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a native Thread accepts a restored generation explicitly and never redelivers its restored message",
  async () => {
    const source = await createTestSyncStack({ application: "thread" });
    const cacheProxy = await createTestSyncProxy(source.cacheURL);
    const authorityProxy = await createTestSyncProxy(source.authorityURL);
    const home = join(source.directory, "native-owner");
    const credentialVariable = `CUELOOP_SYNC_RESTORE_${crypto.randomUUID().replaceAll("-", "_")}`;
    const server = new DaemonServer({
      home,
      idleExitMs: 0,
      sync: { enabledForThread: () => true },
    });
    let owner: DaemonClient | undefined;
    let target: Awaited<ReturnType<typeof createTestSyncStack>> | undefined;
    let reader:
      | ReturnType<typeof createSyncClient<typeof syncThreadSchema, { actorIdentifier: string }>>
      | undefined;

    process.env[credentialVariable] = source.auth;
    server.start();

    try {
      owner = await DaemonClient.connect({ home });
      const thread = await owner.sessionCreate(
        { repoRoot: source.directory, branch: "main" },
        { type: "plan", content: "Plan in the backup", meta: { title: "Saved title" } },
      );
      const binding = await owner.harnessBind(thread.id, "claude-code", "restore-owner");

      await owner.sessionSyncImport(thread.id, {
        authorityURL: authorityProxy.cacheURL,
        cacheURL: cacheProxy.cacheURL,
        workspaceIdentifier: source.authority.workspaceIdentifier,
        actorIdentifier: source.userID,
        authenticationTokenEnvironment: credentialVariable,
      });
      const accepted = await owner.sessionSendMessage(
        thread.id,
        "approved",
        "An identified request before the backup",
      );
      const [delivery] = await owner.deliveryPending(binding.id);

      if (!delivery || !accepted.message)
        throw new Error("Native restore test requires its identified source delivery");

      await owner.deliveryAcknowledge(delivery.delivery.id);
      const backup = await createSyncBackup({
        databaseURL: source.environment.SYNC_DATABASE_URL,
        directory: join(source.directory, "native-backup"),
        tools: {
          dump: [
            "docker",
            "exec",
            "-i",
            source.postgresContainer,
            "env",
            "PGDATABASE=sync_test",
            "PGUSER=sync_test",
            "pg_dump",
          ],
          restore: ["docker", "exec", "-i", source.postgresContainer, "pg_restore"],
        },
      });

      await owner.sessionSubmitRevision(thread.id, "Plan accepted after the snapshot");
      await owner.sessionSetTitle(thread.id, "Accepted title after the snapshot");
      target = await createTestSyncStack({
        application: "thread",
        restoreDirectory: backup.directory,
        authenticationToken: source.auth,
      });

      if (!target.recovery)
        throw new Error("Native restore test requires its target recovery identity");

      reader = createSyncClient({
        authority: target.authority,
        schema: syncThreadSchema,
        cacheURL: target.cacheURL,
        userID: target.userID,
        auth: target.auth,
        kvStore: "mem",
        context: { actorIdentifier: target.userID },
      });
      await fenceSyncAuthority({
        databaseURL: source.environment.SYNC_DATABASE_URL,
        authority: source.authority,
      });
      await activateSyncRestore({
        databaseURL: target.environment.SYNC_DATABASE_URL,
        sourceDatabaseURL: source.environment.SYNC_DATABASE_URL,
        source: target.recovery.source,
        authority: target.recovery.authority,
        verifyReplica: async (configuration) => {
          expect(configuration.appID).toBe(target!.replica.appID);
          const documents = await reader!.run(
            syncThreadQueries.threads({
              workspaceIdentifier: target!.authority.workspaceIdentifier,
              pageSize: 10,
            }),
            { type: "complete" },
          );

          expect(documents).toHaveLength(1);
        },
      });
      authorityProxy.retarget(target.authorityURL);
      cacheProxy.retarget(target.cacheURL);
      await expect(owner.sessionSyncResume(thread.id)).rejects.toMatchObject({
        code: "sync_recovery_required",
      });
      expect((await owner.sessionGet(thread.id)).artifact.meta.title).toBe(
        "Accepted title after the snapshot",
      );
      const recovered = await owner.sessionSyncResume(thread.id, true);

      expect(recovered.artifact.meta.title).toBe("Saved title");
      expect(recovered.message?.id).toBe(accepted.message.id);
      expect(await owner.deliveryPending(binding.id)).toEqual([]);
      await expect(owner.sessionWait(thread.id, 100)).rejects.toMatchObject({
        code: "sync_execution_recovery_required",
      });
      const archives = join(
        home,
        "sync-threads",
        createHash("sha256").update(thread.id).digest("hex"),
        "recovered-projections",
      );
      const [archive] = readdirSync(archives);

      if (!archive) throw new Error("Native restore must retain its full previous projection");

      expect(readFileSync(join(archives, archive), "utf8")).toContain(
        "Accepted title after the snapshot",
      );
      await owner.sessionSubmitRevision(
        thread.id,
        "A new revision after verifying the original execution outcome",
      );
      const fresh = await owner.sessionSendMessage(
        thread.id,
        "approved",
        "A new request after recovery",
      );

      if (!fresh.message) throw new Error("Native restore requires its newly accepted message");

      expect(fresh.message.id).not.toBe(accepted.message.id);
      expect((await owner.deliveryPending(binding.id)).map((value) => value.message.id)).toEqual([
        fresh.message.id,
      ]);
    } finally {
      owner?.close();
      await server.shutdown();
      await reader?.close();
      await authorityProxy.close();
      await cacheProxy.close();
      await target?.close();
      await source.close();
      delete process.env[credentialVariable];
    }
  },
  180000,
);
