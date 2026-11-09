import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { SyncThreadEditor } from "@cueloop/client/sync-editor";
import { DARK } from "../../packages/client/src/appearance/theme";
import { settle, waitForText, waitForState } from "../../packages/client/src/testing/test-support";
import { createTestSyncProxy } from "../helpers/sync-proxy";
import { createSyncDraftStore } from "@cueloop/sync/drafts";
import { waitForTestSyncState } from "../helpers/sync-test-deadline";
import { expect, test } from "bun:test";
import { waitForTestTextEditor } from "../helpers/sync-text-editor";
import { join } from "node:path";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";
import { createSharedTextEditorSession } from "../../examples/sync-workspace/text-editor-client.ts";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "standalone text editor sessions save concurrent drafts without replacing accepted edits",
  async () => {
    const stack = await createTestSyncStack({ collaborator: true });
    const reader = createSharedRecordClient(stack);
    let first: Awaited<ReturnType<typeof createSharedTextEditorSession>> | undefined;
    let second: typeof first;
    let rendered: Awaited<ReturnType<typeof testRender>> | undefined;

    try {
      const [record] = await reader.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record || !stack.collaborator)
        throw new Error("Sync editor test requires its record and collaborator");

      first = await createSharedTextEditorSession({
        ...stack,
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
        storage: createSyncSqliteStorage({ directory: join(stack.directory, "first-editor") }),
      });
      second = await createSharedTextEditorSession({
        ...stack,
        ...stack.collaborator,
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
        storage: createSyncSqliteStorage({ directory: join(stack.directory, "second-editor") }),
      });
      await Promise.all([
        waitForTestTextEditor(
          first,
          (snapshot) => snapshot.connection === "connected",
          "the first editor connection",
        ),
        waitForTestTextEditor(
          second,
          (snapshot) => snapshot.connection === "connected",
          "the second editor connection",
        ),
      ]);
      let exited = false;

      rendered = await testRender(
        React.createElement(SyncThreadEditor, {
          session: first,
          theme: DARK,
          onExit: () => {
            exited = true;
          },
        }),
        { width: 90, height: 16, kittyKeyboard: true },
      );
      await settle(rendered);
      await rendered.mockInput.typeText("Alice: ");
      await waitForText(rendered, "Alice: Shared workspace");
      expect(second.getSnapshot().text).toBe("Shared workspace");
      second.change("Shared workspace with Bob");
      rendered.mockInput.pressKey("RETURN", { ctrl: true });
      expect((await second.save()).status).toBe("accepted");
      await waitForState(rendered, () => exited, "the shared editor's accepted save");
      expect(first.getSnapshot().operation).toBe("accepted");
      await Promise.all([
        waitForTestTextEditor(
          first,
          (snapshot) => snapshot.text === "Alice: Shared workspace with Bob",
          "the first editor's converged text",
        ),
        waitForTestTextEditor(
          second,
          (snapshot) => snapshot.text === "Alice: Shared workspace with Bob",
          "the second editor's converged text",
        ),
      ]);
      await waitForText(rendered, "Alice: Shared workspace with Bob");
      await waitForText(rendered, "Last saved by");
      expect(first.getSnapshot().text).toBe("Alice: Shared workspace with Bob");
      expect(second.getSnapshot().text).toBe("Alice: Shared workspace with Bob");
    } finally {
      rendered?.renderer.destroy();
      await first?.close();
      await second?.close();
      await reader.close();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "text initialization saves its request identity before the authority receives it",
  async () => {
    const stack = await createTestSyncStack({ interceptMutations: true });
    const reader = createSharedRecordClient(stack);
    const storage = createSyncSqliteStorage({ directory: join(stack.directory, "initialization") });
    const drafts = createSyncDraftStore({
      storage,
      authorityIdentifier: stack.authorityURL,
      userIdentifier: stack.userID,
    });
    let opening:
      | Promise<PromiseSettledResult<Awaited<ReturnType<typeof createSharedTextEditorSession>>>[]>
      | undefined;
    let forward: (() => void) | undefined;

    try {
      const [record] = await reader.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record) throw new Error("Sync initialization test requires its record");

      const paused = stack.pauseNextMutation();

      forward = paused.forward;
      opening = Promise.allSettled([
        createSharedTextEditorSession({
          ...stack,
          workspaceIdentifier: record.workspaceIdentifier,
          recordIdentifier: record.id,
          storage,
        }),
      ]);
      await waitForTestSyncState(paused.received, "text initialization to reach the authority");
      const [saved] = await drafts.list();

      expect(saved).toMatchObject({
        status: "pending",
        operation: {
          name: "text.initialize",
          workspaceIdentifier: record.workspaceIdentifier,
          arguments: { recordIdentifier: record.id },
        },
      });
      paused.forward();
      const [result] = await opening;

      if (!result || result.status !== "fulfilled")
        throw new Error("Sync initialization did not open its editor");

      expect(result.value.getSnapshot().text).toBe("Shared workspace");
    } finally {
      forward?.();
      const [result] = await (opening ?? Promise.resolve([]));

      if (result?.status === "fulfilled") await result.value.close();

      await drafts.close();
      await reader.close();
      await stack.close();
    }
  },
  120000,
);

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "offline text drafts survive restart and merge only after an explicit save",
  async () => {
    const stack = await createTestSyncStack({ collaborator: true });
    const proxy = await createTestSyncProxy(stack.cacheURL);
    const reader = createSharedRecordClient(stack);
    const storage = createSyncSqliteStorage({ directory: join(stack.directory, "offline-editor") });
    let first: Awaited<ReturnType<typeof createSharedTextEditorSession>> | undefined;
    let second: typeof first;

    try {
      const [record] = await reader.run(sharedRecordQueries.records(), { type: "complete" });

      if (!record || !stack.collaborator)
        throw new Error("Sync offline editor test requires its record and collaborator");

      const options = {
        ...stack,
        cacheURL: proxy.cacheURL,
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
        storage,
      };

      first = await createSharedTextEditorSession(options);
      second = await createSharedTextEditorSession({
        ...stack,
        ...stack.collaborator,
        workspaceIdentifier: record.workspaceIdentifier,
        recordIdentifier: record.id,
        storage: createSyncSqliteStorage({ directory: join(stack.directory, "online-editor") }),
      });
      await Promise.all([
        waitForTestTextEditor(
          first,
          (snapshot) => snapshot.connection === "connected",
          "the offline editor's initial connection",
        ),
        waitForTestTextEditor(
          second,
          (snapshot) => snapshot.connection === "connected",
          "the online editor's connection",
        ),
      ]);
      proxy.disconnect();
      await waitForTestTextEditor(
        first,
        (snapshot) => snapshot.connection !== "connected",
        "the disconnected editor",
      );
      first.change("Shared workspace with offline notes");
      expect(await first.save()).toEqual({ status: "draft" });
      await first.close();
      first = undefined;
      second.change("Bob: Shared workspace");
      expect((await second.save()).status).toBe("accepted");
      first = await createSharedTextEditorSession(options);
      expect(first.getSnapshot().text).toBe("Shared workspace with offline notes");
      proxy.reconnect();
      await waitForTestTextEditor(
        first,
        (snapshot) => snapshot.connection === "connected" && snapshot.freshness === "complete",
        "the recovered editor's current replica",
      );
      expect(second.getSnapshot().text).toBe("Bob: Shared workspace");
      expect((await first.save()).status).toBe("accepted");
      await waitForTestTextEditor(
        second,
        (snapshot) => snapshot.text === "Bob: Shared workspace with offline notes",
        "the explicitly merged offline edit",
      );
      expect(first.getSnapshot().text).toBe("Bob: Shared workspace with offline notes");
    } finally {
      await first?.close();
      await second?.close();
      await reader.close();
      await proxy.close();
      await stack.close();
    }
  },
  120000,
);
