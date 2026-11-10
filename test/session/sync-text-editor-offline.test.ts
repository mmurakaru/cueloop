import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyncDraftStore } from "@cueloop/sync/drafts";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { createSyncTextState } from "@cueloop/sync/text";
import { createSharedTextEditorSession } from "../../examples/sync-workspace/text-editor-client.ts";
import { sharedTextOperations } from "../../examples/sync-workspace/shared-text.ts";

test.each([false, true])(
  "offline text recovery preserves saved input and submitted identity when pending is %s",
  async (pending) => {
    const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-offline-editor-"));
    const persistent = createSyncSqliteStorage({ directory });
    const openedStores: string[] = [];
    const storage = {
      create(name: string) {
        openedStores.push(name);

        return persistent.create(name);
      },
      drop: persistent.drop,
    };
    const authorityURL = "http://127.0.0.1:1";
    const workspaceIdentifier = "019a691a-c6ae-7000-8000-000000000001";
    const recordIdentifier = "019a691a-c6ae-7000-8000-000000000002";
    const state = createSyncTextState("Plan").state;
    const drafts = createSyncDraftStore({
      storage,
      authorityIdentifier: authorityURL,
      userIdentifier: "owner",
    });
    let editor: Awaited<ReturnType<typeof createSharedTextEditorSession>> | undefined;
    const operation = sharedTextOperations.edit.create({
      workspaceIdentifier,
      arguments: { recordIdentifier, update: state },
    });

    try {
      const saved = await drafts.save({
        content: {
          kind: "shared-text",
          workspaceIdentifier,
          recordIdentifier,
          baseState: state,
          localState: state,
          text: "Unsent offline edit",
          role: "editor",
        },
      });

      if (pending)
        await drafts.markSubmitted({ draftIdentifier: saved.draftIdentifier, operation });

      await drafts.close();
      editor = await createSharedTextEditorSession({
        cacheURL: authorityURL,
        authorityURL,
        userID: "owner",
        auth: "test-credential",
        workspaceIdentifier,
        recordIdentifier,
        storage,
      });
      expect(editor.getSnapshot()).toMatchObject({
        text: "Unsent offline edit",
        connection: "disconnected",
        freshness: "cached",
        editable: !pending,
      });
      expect(openedStores.some((name) => name.includes("zero-owner-"))).toBe(false);

      if (pending) {
        expect(() => editor!.change("Cannot replace an uncertain request")).toThrow(
          "original operation",
        );
        expect(await editor.save()).toEqual({
          status: "pending",
          operationIdentifier: operation.operationIdentifier,
          workspaceIdentifier,
        });
      } else {
        editor.change("Revised offline input");
        expect(await editor.save()).toEqual({ status: "draft" });
      }

      await editor.close();
      const recovered = createSyncDraftStore({
        storage,
        authorityIdentifier: authorityURL,
        userIdentifier: "owner",
      });

      try {
        const [record] = await recovered.list();

        expect(record?.draftIdentifier).toBe(saved.draftIdentifier);

        if (pending) expect(record).toMatchObject({ status: "pending", operation });
        else
          expect(record?.content).toMatchObject({
            text: "Revised offline input",
            baseState: state,
            localState: state,
          });
      } finally {
        await recovered.close();
      }
    } finally {
      await editor?.close();
      await drafts.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
