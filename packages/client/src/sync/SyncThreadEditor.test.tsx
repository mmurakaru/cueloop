import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import {
  createSyncTextDocument,
  createSyncTextState,
  type SyncTextEditorSession,
  type SyncTextEditorSnapshot,
} from "@cueloop/sync/text";
import { DARK } from "../appearance/theme";
import { settle, waitForText, waitForState } from "../testing/test-support";
import { SyncThreadEditor } from "./SyncThreadEditor";

test.each(["Plan", "Plan 世界 🌍", "Plan e\u0301"])(
  "shared text preserves the editing caret for %s",
  async (initialText) => {
    const initial = createSyncTextState(initialText);
    const document = createSyncTextDocument({ state: initial.state, canEdit: () => true });
    const remote = createSyncTextDocument({ state: initial.state, canEdit: () => true });
    const listeners = new Set<() => void>();
    let snapshot: SyncTextEditorSnapshot = {
      text: initialText,
      textState: initial.state,
      connection: "connected",
      freshness: "complete",
      lifecycle: "active",
      operation: "idle",
      saving: false,
      draftSaved: false,
      editable: true,
    };
    let changes = 0;
    let saves = 0;
    let exited = false;
    const publish = () => {
      for (const listener of listeners) listener();
    };
    const session: SyncTextEditorSession = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);

        return () => {
          listeners.delete(listener);
        };
      },
      change(text) {
        changes++;
        document.replace(text);
        snapshot = { ...snapshot, text, textState: document.snapshot.state, draftSaved: true };
        publish();
      },
      async save() {
        saves++;

        return { status: "unchanged" };
      },
      async close() {
        document.close();
      },
    };
    const setup = await testRender(
      <SyncThreadEditor
        session={session}
        theme={DARK}
        onExit={() => {
          exited = true;
        }}
        annotations={[
          {
            id: "plan-note",
            kind: "comment",
            anchor: { quote: "Plan", prefix: "", suffix: "" },
            body: "Discuss this",
            createdAt: "2023-11-14T22:13:20.000Z",
          },
        ]}
      />,
      { width: 70, height: 14, kittyKeyboard: true },
    );

    try {
      await settle(setup);
      setup.mockInput.pressKey("END");
      await setup.mockInput.typeText("x");
      await waitForText(setup, `${initialText}x`);
      expect(changes).toBe(1);
      const update = remote.edit({ index: 0, deleteCount: 0, insert: "Shared " });

      document.receive(update.state);
      snapshot = { ...snapshot, text: document.snapshot.text, textState: document.snapshot.state };
      publish();
      await settle(setup);
      await waitForText(setup, `Shared ${initialText}x`);
      expect(changes).toBe(1);
      await setup.mockInput.typeText("!");
      await waitForText(setup, `Shared ${initialText}x!`);
      expect(session.getSnapshot().text).toBe(`Shared ${initialText}x!`);
      remote.edit({ index: 7, deleteCount: 4, insert: "" });
      document.receive(remote.snapshot.state);
      snapshot = { ...snapshot, text: document.snapshot.text, textState: document.snapshot.state };
      publish();
      await settle(setup);
      await waitForText(setup, "1 orphaned annotation");
      setup.mockInput.pressKey("RETURN", { ctrl: true });
      await waitForState(setup, () => exited, "the explicit save to finish");
      expect(saves).toBe(1);
    } finally {
      setup.renderer.destroy();
      await session.close();
      remote.close();
    }
  },
);
