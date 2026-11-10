import * as v from "valibot";
import { fetchSyncWorkspaceAuthority } from "./sync-authority-client.ts";
import type { SyncDraftRecord, createSyncDraftStore } from "./sync-draft-store.ts";
import { lookupSyncOperationOutcome, type SyncOperationOutcome } from "./sync-operation-client.ts";
import type { SyncOperation, SyncOperationReceipt } from "./sync-operation.ts";

/** Copy drafts before switching configuration; neither saved envelopes nor the source store are changed. */
export async function rebindSyncWorkspace(options: {
  authorityURL: string;
  workspaceIdentifier: string;
  headers: HeadersInit;
  sourceDrafts: ReturnType<typeof createSyncDraftStore>;
  targetDrafts: ReturnType<typeof createSyncDraftStore>;
  selectDraft: (draft: SyncDraftRecord) => boolean;
  lookup: (operation: SyncOperation) => Promise<SyncOperationReceipt | undefined>;
  signal?: AbortSignal;
}) {
  const selectDraft = v.parse(v.function(), options.selectDraft);
  const authority = await fetchSyncWorkspaceAuthority(options);
  const records = (await options.sourceDrafts.list()).filter(
    (draft) =>
      (draft.status === "draft" ||
        draft.operation.workspaceIdentifier === authority.workspaceIdentifier) &&
      v.parse(v.boolean(), selectDraft(draft)),
  );

  await options.targetDrafts.importRecords(records);
  const pending: { draft: SyncDraftRecord; outcome: SyncOperationOutcome }[] = [];

  for (const draft of records) {
    if (
      draft.status !== "pending" ||
      draft.operation.workspaceIdentifier !== authority.workspaceIdentifier
    )
      continue;

    options.signal?.throwIfAborted();
    const outcome = await lookupSyncOperationOutcome({
      operation: draft.operation,
      lookup: options.lookup,
    });

    pending.push({ draft, outcome });
  }

  return { authority, pending };
}
