import { writeFileSync } from "node:fs";
import { createTestGitRepo } from "../helpers/git-repo";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { createSyncClient } from "@cueloop/sync";
import { submitSyncOperation } from "@cueloop/sync/operations";
import { syncThreadSchema } from "@cueloop/daemon/sync-thread-schema";
import { syncThreadQueries } from "@cueloop/daemon/sync-thread-queries";
import { syncThreadMutators } from "@cueloop/daemon/sync-thread-mutators";
import {
  syncThreadOperations,
  prepareSyncThreadImport,
} from "@cueloop/daemon/sync-thread-protocol";
import { lookupSyncThreadOperation } from "@cueloop/daemon/sync-thread-import-client";
import { runHarnessBridge } from "@cueloop/adapters/harness-bridge";
import { createTestSyncStack } from "../helpers/sync-stack";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "native daemon import retains adapter delivery and comment mediation across restart and a disabled flag",
  async () => {
    const stack = await createTestSyncStack({
      application: "thread",
      collaborator: true,
      interceptMutations: true,
    });
    const home = join(stack.directory, "owner");
    const credentialVariable = `CUELOOP_SYNC_TEST_${crypto.randomUUID().replaceAll("-", "_")}`;
    let enabled = true;
    let server = new DaemonServer({
      home,
      idleExitMs: 0,
      sync: { enabledForThread: () => enabled },
    });
    let owner: DaemonClient | undefined;
    let peer: DaemonClient | undefined;
    const reader = createSyncClient({
      schema: syncThreadSchema,
      mutators: syncThreadMutators,
      cacheURL: stack.cacheURL,
      userID: stack.userID,
      auth: stack.auth,
      kvStore: "mem",
      context: { actorIdentifier: stack.userID },
    });

    process.env[credentialVariable] = stack.auth;
    server.start();

    try {
      const [workspace] = await reader.run(syncThreadQueries.workspaces({ pageSize: 1 }), {
        type: "complete",
      });

      if (!workspace) throw new Error("Sync daemon test requires its workspace");

      owner = await DaemonClient.connect({ home });
      const thread = await owner.sessionCreate(
        { repoRoot: stack.directory, branch: "main" },
        { type: "plan", content: "Original plan", meta: { title: "Native imported Thread" } },
      );
      const binding = await owner.harnessBind(thread.id, "claude-code", "sync-owner-test");
      const imported = await owner.sessionSyncImport(thread.id, {
        authorityURL: stack.authorityURL,
        cacheURL: stack.cacheURL,
        workspaceIdentifier: workspace.id,
        actorIdentifier: stack.userID,
        authenticationTokenEnvironment: credentialVariable,
      });

      expect(imported.id).toBe(thread.id);
      expect(() => server.core.sessionSetWorkingCopy(thread.id, "Competing local edit")).toThrow(
        "authority",
      );
      peer = await DaemonClient.connect({
        home,
        role: "collaborator",
        author: "verified-ssh-author",
      });
      const commented = await peer.sessionAnnotate(thread.id, {
        id: "ssh-comment",
        kind: "comment",
        author: "forged-owner",
        body: "Review from an SSH collaborator",
        anchor: { quote: "Original", prefix: "", suffix: " plan" },
      });

      expect(
        commented.annotations.find((annotation) => annotation.id === "ssh-comment")?.author,
      ).toBe("verified-ssh-author");
      await expect(peer.sessionSendMessage(thread.id, "approved", "Unauthorized")).rejects.toThrow(
        "cannot call",
      );
      const edited = await owner.sessionSetWorkingCopy(
        thread.id,
        "Reviewed through the existing socket API",
      );

      expect(edited.workingCopy).toBe("Reviewed through the existing socket API");
      const lostAcknowledgement = stack.pauseNextMutation();
      const interruptedComment = owner
        .sessionAnnotate(thread.id, {
          id: "accepted-before-owner-restart",
          kind: "comment",
          author: stack.userID,
          body: "Retain this operation identity",
          anchor: { quote: "Reviewed", prefix: "", suffix: " through the existing socket API" },
        })
        .catch(() => undefined);

      await lostAcknowledgement.received;
      lostAcknowledgement.forward();
      await lostAcknowledgement.processed;
      owner.close();
      peer.close();
      await server.shutdown();
      await interruptedComment;
      await stack.restartAuthority();
      enabled = false;
      server = new DaemonServer({ home, idleExitMs: 0, sync: { enabledForThread: () => enabled } });
      server.start();
      owner = await DaemonClient.connect({ home });

      expect((await owner.sessionGet(thread.id)).workingCopy).toBe(edited.workingCopy);
      await expect(owner.sessionSetWorkingCopy(thread.id, "Flag-off fork")).rejects.toThrow(
        "read-only",
      );
      enabled = true;
      await owner.sessionSyncResume(thread.id);
      const retained = (await owner.sessionSyncDrafts(thread.id)).find((draft) =>
        draft.content.includes("accepted-before-owner-restart"),
      );

      if (!retained)
        throw new Error(
          "Lost acknowledgement must retain its saved command identity across restart",
        );

      await owner.sessionSyncRetry(thread.id, retained.draftIdentifier);
      expect(
        (await owner.sessionGet(thread.id)).annotations.filter(
          (annotation) => annotation.id === "accepted-before-owner-restart",
        ),
      ).toHaveLength(1);
      expect(await owner.sessionSyncDrafts(thread.id)).toEqual([]);

      const waiting = owner.sessionWait(thread.id, 30000);
      const sent = await owner.sessionSendMessage(
        thread.id,
        "approved",
        "Ship this plan",
        undefined,
        "stable-native-message",
      );

      expect((await waiting)?.message?.id).toBe(sent.message?.id);

      if (!sent.message?.id)
        throw new Error("Imported Thread must receive an identified native Message");

      const pending = await runHarnessBridge(
        { operation: "pending", harness: "claude-code", harnessSessionId: "sync-owner-test" },
        home,
      );

      if (pending.operation !== "pending" || !pending.deliveries[0])
        throw new Error("Imported Thread must release a native adapter delivery after acceptance");

      expect(pending.deliveries).toHaveLength(1);
      expect(pending.deliveries[0].message.id).toBe(sent.message?.id);
      await runHarnessBridge(
        {
          operation: "ack",
          bindingId: binding.id,
          deliveryId: pending.deliveries[0].deliveryId,
          messageId: sent.message.id,
        },
        home,
      );
      const replayed = await owner.sessionSendMessage(
        thread.id,
        "approved",
        "Ship this plan",
        undefined,
        "stable-native-message",
      );

      expect(replayed.message?.id).toBe(sent.message?.id);
      expect(await owner.deliveryPending(binding.id)).toEqual([]);
      const [metadata] = await reader.run(
        syncThreadQueries.threads({ workspaceIdentifier: workspace.id, pageSize: 10 }),
        { type: "complete" },
      );

      if (!metadata) throw new Error("Imported Thread must retain its authority metadata");

      const replay = syncThreadOperations.command.create({
        workspaceIdentifier: workspace.id,
        arguments: {
          recordIdentifier: metadata.id,
          expectedVersion: 1,
          method: "session.sendMessage",
          parameters: {
            id: thread.id,
            outcome: "approved",
            summary: "Ship this plan",
            operationId: "stable-native-message",
          },
        },
      });
      const receipt = await submitSyncOperation({
        operation: replay,
        submit: (operation) => reader.mutate(syncThreadMutators.thread.command(operation)),
        lookup: (operation) =>
          lookupSyncThreadOperation({
            authorityURL: stack.authorityURL,
            authenticationToken: stack.auth,
            operation,
          }),
      });

      expect(receipt.status).toBe("accepted");
      const fork = await owner.sessionFork(thread.id);

      expect(fork.id).not.toBe(thread.id);
      expect(fork.parentSessionId).toBe(thread.id);
      await owner.sessionDelete(fork.id);
      expect((await owner.sessionList()).map((item) => item.id)).not.toContain(fork.id);
      expect((await owner.sessionGet(thread.id)).message?.id).toBe(sent.message?.id);
      const recoveryThread = await owner.sessionCreate(
        { repoRoot: stack.directory, branch: "main" },
        { type: "plan", content: "Retained after a rejected import", meta: {} },
      );
      const recoveryConnection = {
        authorityURL: stack.authorityURL,
        cacheURL: stack.cacheURL,
        workspaceIdentifier: workspace.id,
        actorIdentifier: stack.userID,
        authenticationTokenEnvironment: credentialVariable,
      };
      const recoveryUpload = await prepareSyncThreadImport({
        workspaceIdentifier: workspace.id,
        thread: recoveryThread,
      });
      const expired = {
        ...recoveryUpload,
        operation: syncThreadOperations.import.create({
          workspaceIdentifier: workspace.id,
          arguments: recoveryUpload.operation.arguments,
          now: () => Date.now() - 600000,
        }),
      };

      server.core.sessionFenceForSync({
        id: recoveryThread.id,
        snapshot: recoveryUpload.snapshot,
        connection: {
          ...recoveryConnection,
          recordIdentifier: recoveryUpload.operation.arguments.recordIdentifier,
        },
        upload: JSON.stringify(expired),
      });
      await expect(owner.sessionSyncResume(recoveryThread.id)).rejects.toThrow("rejected");
      expect(() =>
        server.core.sessionSetWorkingCopy(recoveryThread.id, "Unfenced rejected import"),
      ).toThrow("authority");
      const retried = await owner.sessionSyncImport(recoveryThread.id, recoveryConnection);

      expect(retried.id).toBe(recoveryThread.id);
      expect(retried.artifact.content).toBe("Retained after a rejected import");
      const repository = createTestGitRepo([
        { path: "owner.txt", before: "before\n", after: "first owner diff\n" },
      ]);

      try {
        const initialDiff = await repository.diff();
        const diffThread = await owner.sessionCreate(
          { repoRoot: repository.dir, branch: "main" },
          {
            type: "diff",
            content: initialDiff.patch,
            files: initialDiff.files,
            meta: { title: "Owner-local capture" },
          },
        );

        await owner.sessionSyncImport(diffThread.id, recoveryConnection);
        await owner.subscribe();
        const refreshed = Promise.withResolvers<void>();
        const connection = owner;
        const unsubscribe = owner.onEvent((event) => {
          if (event.sessionId !== diffThread.id || event.event !== "session.updated") return;

          void connection
            .sessionGet(diffThread.id)
            .then((current) => {
              if (current.artifact.content.includes("second owner diff")) refreshed.resolve();
            })
            .catch(refreshed.reject);
        });
        const timer = setTimeout(
          () =>
            refreshed.reject(
              new Error("Imported diff did not receive its committed owner-local capture"),
            ),
          30000,
        );

        try {
          writeFileSync(join(repository.dir, "owner.txt"), "second owner diff\n");
          await owner.sessionRefreshDiff(diffThread.id);
          await refreshed.promise;
          expect((await owner.sessionGet(diffThread.id)).artifact.content).toContain(
            "+second owner diff",
          );
          expect(() =>
            server.core.sessionSetWorkingCopy(diffThread.id, "Competing captured diff"),
          ).toThrow("authority");
        } finally {
          clearTimeout(timer);
          unsubscribe();
          await owner.sessionDelete(diffThread.id);
        }
      } finally {
        repository.cleanup();
      }
    } finally {
      owner?.close();
      peer?.close();
      await server.shutdown();
      await reader.close();
      delete process.env[credentialVariable];
      await stack.close();
    }
  },
  120000,
);
