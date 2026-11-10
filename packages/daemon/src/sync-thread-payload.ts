import {
  SyncOperationConflict,
  SyncOperationSchema,
  type SyncOperation,
} from "@cueloop/sync/operations";
import { findSyncOperationReceipt } from "@cueloop/sync/server";
import * as v from "valibot";
import {
  authorizeSyncThreadWorkspace,
  SyncThreadAccessError,
  type SyncThreadTransaction,
} from "./sync-thread-access";
import { assertSyncThreadCommandAccess } from "./sync-thread-command";
import {
  fingerprintSyncThreadSnapshot,
  parseSyncThreadSnapshot,
  SyncThreadCommandSchema,
  SyncThreadCommandUploadSchema,
  SyncThreadImportUploadSchema,
  type SyncThreadPayload,
} from "./sync-thread-protocol";

type ThreadImportUpload = v.InferOutput<typeof SyncThreadImportUploadSchema>;
type ThreadCommandUpload = v.InferOutput<typeof SyncThreadCommandUploadSchema>;
type ThreadPayloadOperation = ThreadImportUpload["operation"] | ThreadCommandUpload["operation"];

async function stageSyncThreadPayload(options: {
  transaction: SyncThreadTransaction;
  actorIdentifier: string;
  operation: ThreadPayloadOperation;
  serialized: SyncThreadPayload;
}) {
  const principal = await authorizeSyncThreadWorkspace({
    transaction: options.transaction,
    workspaceIdentifier: options.operation.workspaceIdentifier,
    actorIdentifier: options.actorIdentifier,
  });
  const receipt = await findSyncOperationReceipt({
    transaction: options.transaction,
    definition: { schema: SyncOperationSchema },
    operation: options.operation,
    actorIdentifier: principal.actorIdentifier,
    authorize: async () => {},
  });

  if (receipt) return;

  if (options.operation.name === "thread.import") {
    if (principal.role !== "owner") throw new SyncThreadAccessError();
  } else {
    assertSyncThreadCommandAccess(principal, options.operation.arguments.method);
  }

  if (
    (await fingerprintSyncThreadSnapshot(options.serialized)) !== options.operation.arguments.digest
  )
    throw new SyncOperationConflict();

  const payload =
    options.operation.name === "thread.import"
      ? parseSyncThreadSnapshot(options.serialized)
      : v.parse(SyncThreadCommandSchema, {
          method: options.operation.arguments.method,
          parameters: JSON.parse(options.serialized),
        }).parameters;

  if (options.operation.name !== "thread.import") {
    const rows = await options.transaction.dbTransaction.query(
      "SELECT id FROM cueloop_sync_thread WHERE id = $1 AND workspace_identifier = $2 AND deleted_at IS NULL FOR SHARE",
      [options.operation.arguments.recordIdentifier, options.operation.workspaceIdentifier],
    );

    if (![...rows].length) throw new SyncThreadAccessError();
  }

  const operation = JSON.stringify(options.operation);

  await options.transaction.dbTransaction.query(
    "INSERT INTO cueloop_sync_thread_payload (id, workspace_identifier, actor_identifier, record_identifier, operation, digest, payload) VALUES ($1, $2, $3, $4, $5::text::jsonb, $6, $7::text::jsonb) ON CONFLICT (id) DO NOTHING",
    [
      options.operation.operationIdentifier,
      options.operation.workspaceIdentifier,
      principal.actorIdentifier,
      options.operation.arguments.recordIdentifier,
      operation,
      options.operation.arguments.digest,
      JSON.stringify(payload),
    ],
  );
  const rows = await options.transaction.dbTransaction.query(
    "SELECT actor_identifier = $2 AND workspace_identifier = $3 AND record_identifier = $4 AND operation = $5::text::jsonb AND digest = $6 AS matches FROM cueloop_sync_thread_payload WHERE id = $1 FOR UPDATE",
    [
      options.operation.operationIdentifier,
      principal.actorIdentifier,
      options.operation.workspaceIdentifier,
      options.operation.arguments.recordIdentifier,
      operation,
      options.operation.arguments.digest,
    ],
  );
  const [staged] = v.parse(v.array(v.object({ matches: v.boolean() })), [...rows]);

  if (!staged?.matches) throw new SyncOperationConflict();
}

export function stageSyncThreadImport(options: {
  transaction: SyncThreadTransaction;
  actorIdentifier: string;
  upload: ThreadImportUpload;
}) {
  return stageSyncThreadPayload({
    ...options,
    operation: options.upload.operation,
    serialized: options.upload.snapshot,
  });
}

export function stageSyncThreadCommand(options: {
  transaction: SyncThreadTransaction;
  actorIdentifier: string;
  upload: ThreadCommandUpload;
}) {
  return stageSyncThreadPayload({
    ...options,
    operation: options.upload.operation,
    serialized: options.upload.parameters,
  });
}

export async function readSyncThreadPayload(options: {
  transaction: SyncThreadTransaction;
  actorIdentifier: string;
  operation: SyncOperation;
}) {
  const rows = await options.transaction.dbTransaction.query(
    "SELECT payload FROM cueloop_sync_thread_payload WHERE id = $1 AND actor_identifier = $2 AND workspace_identifier = $3 AND operation = $4::text::jsonb AND deleted_at IS NULL AND expires_at > clock_timestamp() FOR UPDATE",
    [
      options.operation.operationIdentifier,
      options.actorIdentifier,
      options.operation.workspaceIdentifier,
      JSON.stringify(options.operation),
    ],
  );

  return [...rows][0];
}
