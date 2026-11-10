import { readSharedTextDrafts } from "./text-editor-state.ts";
import type { createSyncDraftStore } from "@cueloop/sync/drafts";
import type {
  SyncTextEditorSession,
  SyncTextEditorSnapshot,
  SyncTextSaveOutcome,
} from "@cueloop/sync/text";

/** Offline recovery opens saved input without starting a replica or a presence connection. */
export async function openSharedTextOfflineDraft(options: {
  drafts: ReturnType<typeof createSyncDraftStore>;
  workspaceIdentifier: string;
  recordIdentifier: string;
}): Promise<SyncTextEditorSession | undefined> {
  const [stored] = await readSharedTextDrafts(options);

  if (!stored?.content.success) return;

  const content = stored.content.output;
  const record = stored.record;
  const listeners = new Set<() => void>();
  let text = content.text;
  let savedText = text;
  let closed = false;
  let writing = Promise.resolve();
  let snapshot: SyncTextEditorSnapshot;
  const publish = () => {
    snapshot = {
      text,
      textState: content.localState,
      documentIdentifier: options.recordIdentifier,
      connection: "disconnected",
      freshness: "cached",
      lifecycle: closed ? "closed" : "active",
      operation:
        record.status === "pending"
          ? "pending"
          : record.status === "rejected"
            ? "rejected"
            : record.status === "accepted"
              ? "accepted"
              : "idle",
      saving: false,
      draftSaved: text === savedText,
      editable: !closed && record.status === "draft",
      error: "Offline draft - reopen after reconnect",
    };

    for (const listener of listeners) listener();
  };
  const persist = () => {
    if (record.status !== "draft") return writing;

    const captured = text;
    const result = writing.then(async () => {
      await options.drafts.save({
        draftIdentifier: record.draftIdentifier,
        content: { ...content, text: captured },
      });
      savedText = captured;
      publish();
    });

    writing = result.catch(() => {});

    return result;
  };

  publish();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    change(value) {
      if (closed || record.status !== "draft")
        throw new Error(
          "Offline submitted input retains its original operation; reopen after reconnect",
        );

      text = value;
      publish();
      void persist().catch(() => {
        snapshot = {
          ...snapshot,
          error: "Offline draft could not be saved; keep this editor open",
        };

        for (const listener of listeners) listener();
      });
    },
    async save(): Promise<SyncTextSaveOutcome> {
      if (closed) throw new Error("Offline draft editor is closed");

      if (record.status === "pending")
        return {
          status: "pending",
          operationIdentifier: record.operation.operationIdentifier,
          workspaceIdentifier: record.operation.workspaceIdentifier,
        };

      await persist();

      return { status: "draft" };
    },
    async close() {
      if (closed) return;

      closed = true;
      await writing;
      await options.drafts.close();
      publish();
      listeners.clear();
    },
  };
}
