import type { SyncWorkspaceAuthority } from "@cueloop/sync/authority";
import * as v from "valibot";
import { SyncTextStateSchema, type SyncTextEditorSnapshot } from "@cueloop/sync/text";
import type { createSyncDraftStore } from "@cueloop/sync/drafts";
import type { createSharedRecordClient } from "./client.ts";
import { initializeSharedText } from "./text-initialization.ts";
import { sharedTextOperations } from "./shared-workspace.ts";
import { SharedTextStateResponseSchema } from "./shared-text.ts";

interface SharedTextAuthorityOptions {
  authorityURL: string;
  auth: string;
  workspaceIdentifier: string;
  recordIdentifier: string;
}

export const SharedTextDraftContentSchema = v.object({
  kind: v.literal("shared-text"),
  workspaceIdentifier: v.pipe(v.string(), v.uuid()),
  recordIdentifier: v.pipe(v.string(), v.uuid()),
  baseState: SyncTextStateSchema,
  localState: SyncTextStateSchema,
  text: v.string(),
  role: v.picklist(["viewer", "editor", "owner"]),
  supersededDraftIdentifiers: v.optional(v.array(v.pipe(v.string(), v.uuid())), []),
});

export async function readSharedTextAuthority(options: SharedTextAuthorityOptions) {
  const response = await fetch(new URL("text", `${options.authorityURL.replace(/\/$/, "")}/`), {
    method: "POST",
    headers: { authorization: `Bearer ${options.auth}`, "content-type": "application/json" },
    body: JSON.stringify({
      workspaceIdentifier: options.workspaceIdentifier,
      recordIdentifier: options.recordIdentifier,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) throw new Error(`Shared text read failed with HTTP ${response.status}`);

  return v.parse(SharedTextStateResponseSchema, await response.json());
}

export async function loadSharedTextEditorState(
  options: SharedTextAuthorityOptions & {
    authority: SyncWorkspaceAuthority;
    client: ReturnType<typeof createSharedRecordClient>;
    drafts: ReturnType<typeof createSyncDraftStore>;
  },
) {
  const candidates = await readSharedTextDrafts(options);
  const stored = candidates[0];
  const restored = stored?.content.success ? stored.content.output : undefined;
  let source: v.InferOutput<typeof SharedTextStateResponseSchema>;

  try {
    source = await readSharedTextAuthority(options);

    if (source.textState === null) {
      const initialized = await initializeSharedText({
        authority: options.authority,
        client: options.client,
        drafts: options.drafts,
        authorityURL: options.authorityURL,
        auth: options.auth,
        workspaceIdentifier: options.workspaceIdentifier,
        recordIdentifier: options.recordIdentifier,
        content: source.content,
      });

      source = await readSharedTextAuthority(options);

      if (source.textState === null && initialized.status === "pending")
        throw new Error("Shared text initialization is pending; retry opening the editor");
    }
  } catch (cause) {
    if (!restored) throw cause;

    source = {
      id: options.recordIdentifier,
      workspaceIdentifier: options.workspaceIdentifier,
      content: restored.text,
      textState: restored.baseState,
      textRevision: 0,
      role: restored.role,
    };
  }

  if (!source.textState) throw new Error("Shared text initialization requires an editor or owner");

  const superseded = new Set(restored?.supersededDraftIdentifiers ?? []);

  if (stored?.record.status === "rejected") superseded.add(stored.record.draftIdentifier);

  const supersededDraftIdentifiers = candidates
    .filter(
      (entry) => entry.record.status === "rejected" && superseded.has(entry.record.draftIdentifier),
    )
    .map((entry) => entry.record.draftIdentifier);

  if (stored?.record.status === "accepted") {
    await Promise.all(
      supersededDraftIdentifiers.map((identifier) => options.drafts.discard(identifier)),
    );
    await options.drafts.discard(stored.record.draftIdentifier);
  }

  return {
    ...restoreSharedTextEditorState({
      source: { ...source, textState: source.textState },
      stored,
      restored,
    }),
    supersededDraftIdentifiers,
  };
}

function restoreSharedTextEditorState({
  source,
  stored,
  restored,
}: {
  source: v.InferOutput<typeof SharedTextStateResponseSchema> & { textState: string };
  stored:
    | { record: Awaited<ReturnType<ReturnType<typeof createSyncDraftStore>["list"]>>[number] }
    | undefined;
  restored: v.InferOutput<typeof SharedTextDraftContentSchema> | undefined;
}) {
  const hasDraft = restored !== undefined && stored?.record.status !== "accepted";
  const operation: SyncTextEditorSnapshot["operation"] =
    stored?.record.status === "pending"
      ? "pending"
      : stored?.record.status === "rejected"
        ? "rejected"
        : "idle";

  return {
    source: { ...source, textState: source.textState },
    localState: restored?.localState ?? source.textState,
    baseState: restored?.baseState ?? source.textState,
    text: restored?.text ?? source.content,
    pending:
      stored?.record.status === "pending"
        ? sharedTextOperations.edit.parse(stored.record.operation)
        : undefined,
    draftIdentifier:
      stored?.record.status === "draft" || stored?.record.status === "pending"
        ? stored.record.draftIdentifier
        : undefined,
    hasDraft,
    generation: hasDraft ? 1 : 0,
    operation,
  };
}

export async function readSharedTextDrafts(options: {
  drafts: ReturnType<typeof createSyncDraftStore>;
  workspaceIdentifier: string;
  recordIdentifier: string;
}) {
  const candidates = (await options.drafts.list())
    .map((record) => ({
      record,
      content: v.safeParse(SharedTextDraftContentSchema, record.content),
    }))
    .filter(
      (entry) =>
        entry.content.success &&
        entry.content.output.workspaceIdentifier === options.workspaceIdentifier &&
        entry.content.output.recordIdentifier === options.recordIdentifier,
    )
    .toSorted((left, right) => right.record.updatedAt - left.record.updatedAt);

  return candidates;
}
