import { SyncPresenceSnapshotSchema } from "./sync-presence-protocol.ts";
import type { SyncPresenceSnapshot } from "./sync-presence-client.ts";
import * as v from "valibot";
import { SyncTextStateSchema } from "./sync-text.ts";
import { SyncOperationReceiptSchema, SyncOperationIdentifierSchema } from "./sync-operation.ts";
import type { Connection, ResultType } from "@rocicorp/zero";
import type { SyncClientLifecycle } from "./sync-client.ts";
import type { SyncOperationOutcome } from "./sync-operation-client.ts";

export interface SyncTextRevision {
  readonly identifier: string;
  readonly parentIdentifier: string | null;
  readonly actorIdentifier: string;
  readonly revision: number;
  readonly content: string;
  readonly acceptedAt: number;
}

export interface SyncTextEditorSnapshot {
  readonly text: string;
  readonly textState: string;
  readonly documentIdentifier?: string;
  readonly connection: Connection["state"]["current"]["name"];
  readonly freshness: ResultType;
  readonly lifecycle: SyncClientLifecycle["status"];
  readonly operation: "idle" | "pending" | "accepted" | "rejected" | "recovery-required";
  readonly saving: boolean;
  readonly draftSaved: boolean;
  readonly editable: boolean;
  readonly revision?: SyncTextRevision;
  readonly presence?: SyncPresenceSnapshot;
  readonly error?: string;
}

export type SyncTextSaveOutcome = SyncOperationOutcome | { status: "draft" | "unchanged" };

/** Applications own submission and persistence; the editor consumes stable immutable snapshots. */
export interface SyncTextEditorSession {
  getSnapshot(): SyncTextEditorSnapshot;
  subscribe(listener: () => void): () => void;
  change(text: string): void;
  select?(selection: { anchor: number; focus: number } | null): void;
  save(): Promise<SyncTextSaveOutcome>;
  close(): Promise<void>;
}

const TextEditorSnapshotSchema = v.object({
  text: v.pipe(v.string(), v.maxLength(8 * 1024 * 1024)),
  textState: SyncTextStateSchema,
  documentIdentifier: v.optional(v.pipe(v.string(), v.uuid())),
  connection: v.picklist([
    "initializing",
    "connecting",
    "connected",
    "disconnected",
    "needs-auth",
    "error",
    "closed",
  ]),
  freshness: v.picklist(["unknown", "cached", "complete", "error"]),
  lifecycle: v.picklist(["active", "needs-reset", "storage-failed", "closing", "closed"]),
  operation: v.picklist(["idle", "pending", "accepted", "rejected", "recovery-required"]),
  saving: v.boolean(),
  draftSaved: v.boolean(),
  editable: v.boolean(),
  error: v.optional(v.string()),
  presence: v.optional(SyncPresenceSnapshotSchema),
  revision: v.optional(
    v.object({
      identifier: v.string(),
      parentIdentifier: v.nullable(v.string()),
      actorIdentifier: v.string(),
      revision: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
      content: v.string(),
      acceptedAt: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    }),
  ),
});
const TextEditorSessionMethodsSchema = v.object({
  getSnapshot: v.function(),
  subscribe: v.function(),
  change: v.function(),
  select: v.optional(v.function()),
  save: v.function(),
  close: v.function(),
});

type ApplicationTextEditorSource = v.InferOutput<typeof TextEditorSessionMethodsSchema>;
export const SyncTextEditorSourceSchema = v.custom<ApplicationTextEditorSource>((value) =>
  v.is(TextEditorSessionMethodsSchema, value),
);

const TextSaveOutcomeSchema = v.union([
  SyncOperationReceiptSchema,
  v.object({
    status: v.literal("pending"),
    operationIdentifier: SyncOperationIdentifierSchema,
    workspaceIdentifier: v.pipe(v.string(), v.uuid()),
  }),
  v.object({
    status: v.literal("recovery-required"),
    reason: v.literal("unknown-after-recovery"),
    operationIdentifier: SyncOperationIdentifierSchema,
    workspaceIdentifier: v.pipe(v.string(), v.uuid()),
  }),
  v.object({ status: v.picklist(["draft", "unchanged"]) }),
]);

export async function validateSyncTextEditorSession(
  session: ApplicationTextEditorSource,
): Promise<SyncTextEditorSession> {
  const readSnapshot = (): SyncTextEditorSnapshot => {
    const snapshot: unknown = session.getSnapshot();

    if (!v.is(TextEditorSnapshotSchema, snapshot))
      throw new Error("Sync text editor snapshot is invalid");

    return snapshot;
  };

  try {
    readSnapshot();
  } catch (cause) {
    await session.close();

    throw cause;
  }

  return {
    getSnapshot: readSnapshot,
    subscribe(listener) {
      const unsubscribe = v.parse(v.function(), session.subscribe(listener));

      return () => {
        unsubscribe();
      };
    },
    change(text) {
      session.change(v.parse(v.string(), text));
    },
    select: session.select
      ? (selection) => {
          session.select?.(
            v.parse(
              v.nullable(
                v.object({
                  anchor: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
                  focus: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
                }),
              ),
              selection,
            ),
          );
        }
      : undefined,
    async save() {
      return v.parse(TextSaveOutcomeSchema, await session.save());
    },
    async close() {
      await session.close();
    },
  };
}
