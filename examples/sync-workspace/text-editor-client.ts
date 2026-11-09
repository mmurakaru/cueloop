import { loadSharedTextEditorState, readSharedTextAuthority } from "./text-editor-state.ts";
import type { StoreProvider } from "@rocicorp/zero/sqlite";
import * as v from "valibot";
import { createSyncDraftStore } from "@cueloop/sync/drafts";
import {
  createSyncTextDocument,
  type SyncTextEditorSession,
  type SyncTextEditorSnapshot,
  type SyncTextSaveOutcome,
} from "@cueloop/sync/text";
import { submitSyncOperation } from "@cueloop/sync/operations";
import { createSharedRecordClient } from "./client.ts";
import {
  sharedWorkspaceMutators,
  sharedWorkspaceQueries,
  sharedTextOperations,
} from "./shared-workspace.ts";
import { SharedTextStateRequestSchema } from "./shared-text.ts";
import { lookupSharedOperationReceipt } from "./operation-receipt-client.ts";

export async function createSharedTextEditorSession(options: {
  cacheURL: string;
  authorityURL: string;
  userID: string;
  auth: string;
  storageKey?: string;
  storage: StoreProvider | "idb";
  workspaceIdentifier: string;
  recordIdentifier: string;
}): Promise<SyncTextEditorSession> {
  const request = v.parse(SharedTextStateRequestSchema, {
    workspaceIdentifier: options.workspaceIdentifier,
    recordIdentifier: options.recordIdentifier,
  });
  const drafts = createSyncDraftStore({
    storage: options.storage,
    authorityIdentifier: options.authorityURL,
    userIdentifier: options.userID,
  });
  const client = createSharedRecordClient({
    ...options,
    storage: options.storage,
    storageKey: options.storageKey ?? options.authorityURL,
  });
  const query = sharedWorkspaceQueries.textDocument(request);
  const view = client.materialize(query);
  const historyView = client.materialize(
    sharedWorkspaceQueries.textHistory({ ...request, pageSize: 1 }),
  );
  const readAuthority = () => readSharedTextAuthority({ ...options, ...request });
  const lookup = (operation: v.InferOutput<typeof sharedTextOperations.edit.schema>) =>
    lookupSharedOperationReceipt({
      authorityURL: options.authorityURL,
      auth: options.auth,
      operation,
    });

  try {
    const initial = await loadSharedTextEditorState({
      ...options,
      ...request,
      client,
      drafts,
    });
    const { source } = initial;
    let role = source.role;
    let closed = false;
    let closing: Promise<void> | undefined;
    let saving: Promise<SyncTextSaveOutcome> | undefined;
    let pending = initial.pending;
    const document = createSyncTextDocument({
      state: initial.localState,
      canEdit: () =>
        client.connection.state.current.name === "connected" &&
        client.lifecycle.current.status === "active" &&
        role !== "viewer",
    });
    let baseState = initial.baseState;
    let text = initial.text;
    let draftIdentifier = initial.draftIdentifier;
    let hasDraft = initial.hasDraft;
    let generation = initial.generation;
    let persistedGeneration = generation;
    let persisting: Promise<void> | undefined;
    let operation: SyncTextEditorSnapshot["operation"] = initial.operation;
    let revision: SyncTextEditorSnapshot["revision"];
    let freshness: SyncTextEditorSnapshot["freshness"] = "unknown";
    let error: string | undefined;
    const listeners = new Set<() => void>();
    let snapshot: SyncTextEditorSnapshot;
    const publish = () => {
      snapshot = {
        text,
        textState: document.snapshot.state,
        connection: client.connection.state.current.name,
        freshness,
        lifecycle: client.lifecycle.current.status,
        operation,
        saving: saving !== undefined,
        draftSaved: hasDraft && generation === persistedGeneration,
        editable: !closed && !saving && operation !== "pending" && role !== "viewer",
        revision,
        error,
      };

      for (const listener of listeners) {
        try {
          listener();
        } catch (cause) {
          console.error("Shared text listener failed", cause);
        }
      }
    };
    const synchronize = (state: string) => {
      const previous = document.snapshot.text;

      if (text !== previous) return;

      document.receive(state);
      text = document.snapshot.text;

      if (!hasDraft && !saving) baseState = state;
    };

    synchronize(source.textState);
    publish();
    const persist = () => {
      if (persisting) return persisting;

      const run = async () => {
        while (persistedGeneration < generation) {
          const capturedGeneration = generation;
          const content = {
            kind: "shared-text",
            ...request,
            baseState,
            localState: document.snapshot.state,
            text,
            role,
          };
          const saved = await drafts.save({ draftIdentifier, content });

          draftIdentifier = saved.draftIdentifier;
          persistedGeneration = capturedGeneration;
        }
      };

      persisting = run();
      void persisting.then(
        () => {
          persisting = undefined;
          publish();
        },
        (cause) => {
          persisting = undefined;
          error = cause instanceof Error ? cause.message : "Shared text draft could not be saved";
          publish();
        },
      );

      return persisting;
    };
    const unsubscribeView = view.addListener((record, resultType, queryError) => {
      freshness = resultType;

      if (record) {
        role =
          record.memberships[0]?.role === "owner"
            ? "owner"
            : record.memberships[0]?.role === "editor"
              ? "editor"
              : "viewer";

        if (record.textState) synchronize(record.textState);
      } else if (resultType === "complete") {
        role = "viewer";
        error = "Shared text access is unavailable; retain your local draft";
      }

      if (queryError) error = queryError.message;

      publish();
    });
    const unsubscribeHistory = historyView.addListener((entries) => {
      const current = entries[0];

      revision = current
        ? {
            identifier: current.id,
            parentIdentifier: current.parentIdentifier,
            actorIdentifier: current.actorIdentifier,
            revision: current.revision,
            content: current.content,
            acceptedAt: current.createdAt,
          }
        : undefined;
      publish();
    });
    const unsubscribeConnection = client.connection.state.subscribe(publish);
    const unsubscribeLifecycle = client.lifecycle.subscribe(publish);
    const submit = async (): Promise<SyncTextSaveOutcome> => {
      error = undefined;

      if (client.connection.state.current.name !== "connected") {
        if (!pending) await persist();

        return { status: "draft" };
      }

      if (!hasDraft && !pending) return { status: "unchanged" };

      if (!pending) {
        if (text !== document.snapshot.text) document.replace(text);

        const current = await readAuthority();

        if (current.textState) document.receive(current.textState);

        text = document.snapshot.text;
        generation++;
        await persist();
        const requestOperation = sharedTextOperations.edit.create({
          workspaceIdentifier: request.workspaceIdentifier,
          arguments: {
            recordIdentifier: request.recordIdentifier,
            update: document.updateSince(baseState),
          },
        });

        if (!draftIdentifier) throw new Error("Shared text draft must be saved before submission");

        await drafts.markSubmitted({ draftIdentifier, operation: requestOperation });
        pending = requestOperation;
        operation = "pending";
        publish();
      }

      const requestOperation = pending;
      const existing = await lookup(requestOperation);
      const outcome =
        existing ??
        (await submitSyncOperation({
          operation: requestOperation,
          lookup,
          submit: (value) =>
            client.mutate(
              sharedWorkspaceMutators.text.edit(sharedTextOperations.edit.parse(value)),
            ),
        }));

      operation = outcome.status;

      if (outcome.status === "pending") return outcome;

      if (!draftIdentifier) throw new Error("Shared text operation has no saved draft");

      await drafts.recordReceipt({ draftIdentifier, receipt: outcome });
      pending = undefined;

      if (outcome.status === "accepted") {
        const accepted = await readAuthority();

        if (accepted.textState) document.receive(accepted.textState);

        text = document.snapshot.text;
        baseState = document.snapshot.state;
        hasDraft = false;
        await drafts.discard(draftIdentifier);
        draftIdentifier = undefined;
      } else {
        draftIdentifier = undefined;
        persistedGeneration = 0;
        error =
          outcome.reason.status === "retained"
            ? outcome.reason.message
            : "Shared text operation was rejected";
      }

      return outcome;
    };

    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
      change(value) {
        if (closed || saving || pending)
          throw new Error("Shared text operation must finish before editing continues");

        text = value;
        hasDraft = true;
        operation = "idle";
        error = undefined;

        if (client.connection.state.current.name === "connected") {
          try {
            document.replace(value);
          } catch (cause) {
            error = cause instanceof Error ? cause.message : "Shared text edit is invalid";
          }
        }

        generation++;
        publish();
        void persist();
      },
      save() {
        if (closed) return Promise.reject(new Error("Shared text editor is closed"));

        if (saving) return saving;

        const run = Promise.resolve().then(submit);

        saving = run;
        publish();
        void run.then(
          () => {
            saving = undefined;
            publish();
          },
          (cause) => {
            saving = undefined;
            error = cause instanceof Error ? cause.message : "Shared text submission failed";
            publish();
          },
        );

        return run;
      },
      close() {
        if (closing) return closing;

        closed = true;
        unsubscribeView();
        unsubscribeHistory();
        unsubscribeConnection();
        unsubscribeLifecycle();
        view.destroy();
        historyView.destroy();
        closing = (async () => {
          try {
            await saving;

            if (hasDraft && !pending) await persist();
          } finally {
            document.close();
            await client.close();
            await drafts.close();
            listeners.clear();
          }
        })();

        return closing;
      },
    };
  } catch (cause) {
    view.destroy();
    historyView.destroy();
    await client.close();
    await drafts.close();

    throw cause;
  }
}
