import { expect, test } from "bun:test";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import * as v from "valibot";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { SyncThreadConnectionSchema } from "@cueloop/daemon/sync-thread-protocol";
import { syncThreadTransferAdapter as adapter } from "@cueloop/daemon/sync-thread-transfer";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createTestSyncThreadDrafts } from "../helpers/sync-thread-drafts";
import { createSyncClient } from "@cueloop/sync";
import { syncThreadSchema } from "@cueloop/daemon/sync-thread-schema";
import { syncThreadQueries } from "@cueloop/daemon/sync-thread-queries";
import { SyncWorkspaceAuthoritySchema } from "@cueloop/sync/authority";
import {
  prepareSyncWorkspaceTransfer,
  importSyncWorkspaceTransfer,
  activateSyncWorkspaceTransfer,
  createSyncWorkspaceTransferBinding,
} from "@cueloop/sync/transfer";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "native rebind retains pending envelopes and owner history across endpoint changes and daemon restart",
  async () => {
    const source = await createTestSyncStack({ application: "thread" });
    const home = join(source.directory, "native-transfer-owner");
    const credentialVariable = `CUELOOP_SYNC_TRANSFER_${crypto.randomUUID().replaceAll("-", "_")}`;
    const createServer = () =>
      new DaemonServer({ home, idleExitMs: 0, sync: { enabledForThread: () => true } });
    let server = createServer();
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
        { type: "plan", content: "An accepted native plan", meta: { title: "Transfer title" } },
      );
      const harness = await owner.harnessBind(thread.id, "claude-code", "transfer-owner");

      await owner.sessionSyncImport(thread.id, {
        authorityURL: source.authorityURL,
        cacheURL: source.cacheURL,
        workspaceIdentifier: source.authority.workspaceIdentifier,
        actorIdentifier: source.userID,
        authenticationTokenEnvironment: credentialVariable,
      });
      const sent = await owner.sessionSendMessage(
        thread.id,
        "approved",
        "A request whose provider outcome stays held",
      );
      const threadDirectory = join(
        home,
        "sync-threads",
        createHash("sha256").update(thread.id).digest("hex"),
      );
      const manifest = () =>
        v.parse(
          v.object({ connection: SyncThreadConnectionSchema }),
          JSON.parse(readFileSync(join(threadDirectory, "manifest.json"), "utf8")),
        );
      const projection = () =>
        v.parse(
          v.object({ version: v.number(), authority: SyncWorkspaceAuthoritySchema }),
          JSON.parse(readFileSync(join(threadDirectory, "projection.json"), "utf8")),
        );
      const previousConnection = manifest().connection;
      const retained = await createTestSyncThreadDrafts({
        authority: source.authority,
        home,
        threadIdentifier: thread.id,
        expectedVersion: projection().version,
        connection: previousConnection,
        submitted: true,
      });
      const originalDrafts = await owner.sessionSyncDrafts(thread.id);

      expect(
        originalDrafts.find((draft) => draft.draftIdentifier === retained.retryIdentifier)?.status,
      ).toBe("pending");
      target = await createTestSyncStack({ application: "thread" });
      const binding = createSyncWorkspaceTransferBinding({
        source: source.authority,
        target: target.authority,
        adapter,
      });
      const authority = binding.target;
      const directory = join(source.directory, "native-workspace");

      await prepareSyncWorkspaceTransfer({
        databaseURL: source.environment.SYNC_DATABASE_URL,
        directory,
        binding,
        adapter,
      });
      await importSyncWorkspaceTransfer({
        databaseURL: target.environment.SYNC_DATABASE_URL,
        sourceDatabaseURL: source.environment.SYNC_DATABASE_URL,
        directory,
        adapter,
      });
      reader = createSyncClient({
        authority,
        schema: syncThreadSchema,
        cacheURL: target.cacheURL,
        userID: target.userID,
        auth: target.auth,
        kvStore: "mem",
        context: { actorIdentifier: target.userID },
      });
      await activateSyncWorkspaceTransfer({
        databaseURL: target.environment.SYNC_DATABASE_URL,
        sourceDatabaseURL: source.environment.SYNC_DATABASE_URL,
        binding,
        verifyReplica: async () => {
          const document = await reader!.run(
            syncThreadQueries.ownerDocument({
              workspaceIdentifier: authority.workspaceIdentifier,
              recordIdentifier: previousConnection.recordIdentifier,
            }),
            { type: "complete" },
          );

          expect(document?.document).toMatchObject({
            id: thread.id,
            artifact: { content: "An accepted native plan" },
          });
        },
      });
      process.env[credentialVariable] = target.auth;
      const connection = {
        ...previousConnection,
        authorityURL: target.authorityURL,
        cacheURL: target.cacheURL,
      };
      const rebound = await owner.sessionSyncRebind(thread.id, connection);

      expect(rebound.id).toBe(thread.id);
      expect(rebound.message?.id).toBe(sent.message?.id);
      expect(projection().authority).toEqual(authority);
      expect(readdirSync(join(threadDirectory, "recovered-projections"))).toHaveLength(1);
      expect(await owner.sessionSyncDrafts(thread.id)).toEqual(originalDrafts);
      await expect(
        owner.sessionSyncRetry(thread.id, retained.retryIdentifier),
      ).rejects.toMatchObject({ code: "sync_recovery_required" });
      expect(await owner.deliveryPending(harness.id)).toEqual([]);
      await expect(owner.sessionWait(thread.id, 100)).rejects.toMatchObject({
        code: "sync_execution_recovery_required",
      });
      owner.close();
      owner = undefined;
      await server.shutdown();
      server = createServer();
      server.start();
      owner = await DaemonClient.connect({ home });
      await owner.sessionSyncResume(thread.id);
      expect(await owner.sessionSyncDrafts(thread.id)).toEqual(originalDrafts);
      expect(manifest().connection).toEqual(connection);
      await owner.sessionSubmitRevision(thread.id, "A fresh revision after the handoff");
      await owner.sessionSetTitle(thread.id, "A fresh change at the destination");
      expect((await owner.sessionGet(thread.id)).artifact.meta.title).toBe(
        "A fresh change at the destination",
      );
    } finally {
      owner?.close();
      await server.shutdown();
      await reader?.close();
      await target?.close();
      await source.close();
      delete process.env[credentialVariable];
    }
  },
  120000,
);
