import * as v from "valibot";
import { defineSyncOperation, SyncRecordIdentifierSchema } from "@cueloop/sync/operations";
import { SyncTextUpdateSchema } from "@cueloop/sync/text";
import { createSyncRecordIdentifier } from "@cueloop/sync/operations";
import type { Thread } from "@cueloop/schema";
import { Params, ThreadRecordSchema, type MethodName } from "./validate";

export const SYNC_THREAD_MAXIMUM_DOCUMENT_BYTES = 16 * 1024 * 1024;
const RecordIdentifierSchema = SyncRecordIdentifierSchema;

function threadCommand<Method extends MethodName>(method: Method) {
  return v.object({ method: v.literal(method), parameters: Params[method] });
}

export const SyncThreadCommandSchema = v.variant("method", [
  threadCommand("session.annotate"),
  threadCommand("session.comment"),
  threadCommand("session.removeAnnotation"),
  threadCommand("session.setParticipantName"),
  threadCommand("session.setWorkingCopy"),
  threadCommand("session.cutBlock"),
  threadCommand("session.restoreBlock"),
  threadCommand("session.curate"),
  threadCommand("session.setViewed"),
  threadCommand("session.setTitle"),
  threadCommand("session.navigate"),
  threadCommand("session.branch"),
  threadCommand("session.switch"),
  threadCommand("session.label"),
  threadCommand("session.fork"),
  threadCommand("session.setShares"),
  threadCommand("session.delete"),
  threadCommand("session.mergeShared"),
  threadCommand("session.sendMessage"),
  threadCommand("session.submitRevision"),
  threadCommand("session.applyDiffCapture"),
]);

export type SyncThreadCommandInput = v.InferInput<typeof SyncThreadCommandSchema>;
export type SyncThreadCommand = v.InferOutput<typeof SyncThreadCommandSchema>;
export type SyncThreadCommandName = SyncThreadCommand["method"];
export type SyncThreadCommandParameters = SyncThreadCommand["parameters"];
export const SYNC_THREAD_COMMAND_NAMES = SyncThreadCommandSchema.options.map(
  (option) => option.entries.method.literal,
);

const CommandNameSchema = v.picklist(SYNC_THREAD_COMMAND_NAMES);
const SnapshotDigestSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));

export const SyncThreadDelegationSchema = v.strictObject({
  actorIdentifier: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  scope: v.literal("comments"),
});

export const syncThreadOperations = {
  import: defineSyncOperation({
    name: "thread.import",
    version: 1,
    arguments: v.strictObject({
      recordIdentifier: RecordIdentifierSchema,
      digest: SnapshotDigestSchema,
    }),
  }),
  command: defineSyncOperation({
    name: "thread.command",
    version: 1,
    arguments: v.intersect([
      v.object({
        recordIdentifier: RecordIdentifierSchema,
        expectedVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
        delegation: v.optional(SyncThreadDelegationSchema),
      }),
      SyncThreadCommandSchema,
    ]),
  }),
  stagedCommand: defineSyncOperation({
    name: "thread.command.staged",
    version: 1,
    arguments: v.strictObject({
      recordIdentifier: RecordIdentifierSchema,
      expectedVersion: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
      method: CommandNameSchema,
      delegation: v.optional(SyncThreadDelegationSchema),
      digest: SnapshotDigestSchema,
    }),
  }),
  editText: defineSyncOperation({
    name: "thread.text.edit",
    version: 1,
    arguments: v.strictObject({
      recordIdentifier: RecordIdentifierSchema,
      documentIdentifier: RecordIdentifierSchema,
      update: SyncTextUpdateSchema,
    }),
  }),
};

const SerializedThreadPayloadSchema = v.pipe(
  v.string(),
  v.check(
    (value) => new TextEncoder().encode(value).byteLength <= SYNC_THREAD_MAXIMUM_DOCUMENT_BYTES,
    "Sync Thread payload exceeds its byte budget",
  ),
  v.brand("SyncThreadPayload"),
);

export type SyncThreadPayload = v.InferOutput<typeof SerializedThreadPayloadSchema>;

export const SyncThreadImportUploadSchema = v.strictObject({
  operation: syncThreadOperations.import.schema,
  snapshot: SerializedThreadPayloadSchema,
});

export const SyncThreadCommandUploadSchema = v.strictObject({
  operation: syncThreadOperations.stagedCommand.schema,
  parameters: SerializedThreadPayloadSchema,
});

/** The journal and upload retain identical snapshot bytes while the durable operation stays bounded. */
export async function fingerprintSyncThreadSnapshot(snapshot: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type SyncThreadUnicodeValue = object | string | number | boolean | null | undefined;

function hasValidSyncThreadUnicode(value: unknown): value is SyncThreadUnicodeValue {
  if (typeof value === "string") return !value.includes("\0") && value.isWellFormed();

  if (typeof value === "number") return Number.isFinite(value);

  if (value === null || value === undefined || typeof value === "boolean") return true;

  if (typeof value !== "object") return false;

  return Object.values(value).every(hasValidSyncThreadUnicode);
}

export function serializeSyncThreadSnapshot(input: Thread): SyncThreadPayload {
  const thread = v.parse(ThreadRecordSchema, input);

  if (!hasValidSyncThreadUnicode(thread))
    throw new Error("Sync Thread snapshot requires valid Unicode without null characters");

  if (!Number.isFinite(Date.parse(thread.createdAt)))
    throw new Error("Sync Thread requires a valid creation time");

  if (!thread.id.length || thread.id.length > 1000)
    throw new Error("Sync Thread identity exceeds its database character budget");

  return v.parse(SerializedThreadPayloadSchema, JSON.stringify(thread));
}

export function parseSyncThreadSnapshot(snapshot: SyncThreadPayload): Thread {
  const thread = v.parse(ThreadRecordSchema, JSON.parse(snapshot));

  serializeSyncThreadSnapshot(thread);

  return thread;
}

/** Validate before fencing local writes; retries reuse this complete snapshot and operation. */
export async function prepareSyncThreadImport(options: {
  workspaceIdentifier: string;
  thread: Thread;
}) {
  const snapshot = serializeSyncThreadSnapshot(options.thread);
  const operation = syncThreadOperations.import.create({
    workspaceIdentifier: options.workspaceIdentifier,
    arguments: {
      recordIdentifier: createSyncRecordIdentifier(),
      digest: await fingerprintSyncThreadSnapshot(snapshot),
    },
  });

  return v.parse(SyncThreadImportUploadSchema, { operation, snapshot });
}

interface SyncThreadCommandMetadata {
  recordIdentifier: string;
  expectedVersion: number;
  delegation?: v.InferOutput<typeof SyncThreadDelegationSchema>;
}

export async function prepareSyncThreadCommand(options: {
  workspaceIdentifier: string;
  recordIdentifier: string;
  expectedVersion: number;
  command: SyncThreadCommandInput;
  delegation?: v.InferOutput<typeof SyncThreadDelegationSchema>;
}) {
  const command = v.parse(SyncThreadCommandSchema, options.command);

  if (!hasValidSyncThreadUnicode(command.parameters))
    throw new Error("Sync Thread command requires valid Unicode without null characters");

  const metadata: SyncThreadCommandMetadata = {
    recordIdentifier: options.recordIdentifier,
    expectedVersion: options.expectedVersion,
  };

  if (options.delegation) metadata.delegation = options.delegation;

  const parameters = JSON.stringify(command.parameters);
  const bytes = new TextEncoder().encode(parameters).byteLength;

  if (bytes > SYNC_THREAD_MAXIMUM_DOCUMENT_BYTES)
    throw new Error("Sync Thread command exceeds its byte budget");

  if (bytes <= 256 * 1024) {
    return {
      kind: "inline" as const,
      operation: syncThreadOperations.command.create({
        workspaceIdentifier: options.workspaceIdentifier,
        arguments: { ...metadata, ...command },
      }),
    };
  }

  const operation = syncThreadOperations.stagedCommand.create({
    workspaceIdentifier: options.workspaceIdentifier,
    arguments: {
      ...metadata,
      method: command.method,
      digest: await fingerprintSyncThreadSnapshot(parameters),
    },
  });

  return {
    kind: "staged" as const,
    operation,
    upload: v.parse(SyncThreadCommandUploadSchema, { operation, parameters }),
  };
}
