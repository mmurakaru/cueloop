import type { Thread } from "@cueloop/schema";
import { createSyncRecordIdentifier } from "@cueloop/sync/operations";
import { createSyncTextState } from "@cueloop/sync/text";
import { SyncOperationRejection } from "@cueloop/sync/server";
import * as v from "valibot";
import type { SyncThreadTransaction } from "./sync-thread-access";
import { ThreadRecordSchema } from "./validate";
import { projectSyncThreadForCollaborators } from "./sync-thread-projection";
import { serializeSyncThreadSnapshot } from "./sync-thread-protocol";

const StoredThreadSchema = v.object({
  version: v.pipe(v.number(), v.safeInteger()),
  document: ThreadRecordSchema,
  text_state: v.nullable(v.string()),
  text_document_identifier: v.nullable(v.string()),
  text_revision: v.pipe(v.number(), v.safeInteger()),
});

export type StoredSyncThread = v.InferOutput<typeof StoredThreadSchema>;

export async function lockSyncThread(options: {
  transaction: SyncThreadTransaction;
  workspaceIdentifier: string;
  recordIdentifier: string;
}): Promise<StoredSyncThread> {
  const rows = await options.transaction.dbTransaction.query(
    `SELECT metadata.version::double precision, state.document, projection.text_state,
      projection.text_document_identifier::text, projection.text_revision::double precision
     FROM cueloop_sync_thread AS metadata
     JOIN cueloop_sync_thread_state AS state ON state.id = metadata.id AND state.workspace_identifier = metadata.workspace_identifier
     JOIN cueloop_sync_thread_document AS projection ON projection.id = metadata.id AND projection.workspace_identifier = metadata.workspace_identifier
     WHERE metadata.id = $1 AND metadata.workspace_identifier = $2
       AND metadata.deleted_at IS NULL AND state.deleted_at IS NULL AND projection.deleted_at IS NULL
     FOR UPDATE OF metadata, state, projection`,
    [options.recordIdentifier, options.workspaceIdentifier],
  );
  const [row] = [...rows];

  if (!row)
    throw new SyncOperationRejection({
      code: "thread_unavailable",
      message: "Sync Thread is unavailable",
    });

  return v.parse(StoredThreadSchema, row);
}

function initialSyncThreadText(thread: Thread) {
  const content = thread.workingCopy ?? thread.artifact.content;

  if (thread.artifact.type !== "plan" || content.length > 100000)
    return { state: null, identifier: null, revision: 0 };

  return {
    state: createSyncTextState(content).state,
    identifier: createSyncRecordIdentifier(),
    revision: 0,
  };
}

export async function writeSyncThread(options: {
  transaction: SyncThreadTransaction;
  workspaceIdentifier: string;
  recordIdentifier: string;
  thread: Thread;
  previous?: StoredSyncThread;
  resetText?: boolean;
  text?: { state: string; identifier: string; revision: number };
}) {
  let document;

  try {
    document = serializeSyncThreadSnapshot(options.thread);
  } catch {
    throw new SyncOperationRejection({
      code: "invalid_thread_document",
      message: "Sync Thread document exceeds its size budget or contains unsupported data",
    });
  }

  if (options.previous && options.previous.version >= Number.MAX_SAFE_INTEGER)
    throw new SyncOperationRejection({
      code: "thread_version_limit",
      message: "Sync Thread reached its version limit",
    });

  const previous = options.previous;
  const unchangedText =
    previous &&
    !options.resetText &&
    previous.document.artifact.type === options.thread.artifact.type &&
    previous.document.artifact.content === options.thread.artifact.content &&
    (previous.document.workingCopy ?? previous.document.artifact.content) ===
      (options.thread.workingCopy ?? options.thread.artifact.content);
  const text =
    options.text ??
    (unchangedText
      ? {
          state: previous.text_state,
          identifier: previous.text_document_identifier,
          revision: previous.text_revision,
        }
      : initialSyncThreadText(options.thread));
  const version = (previous?.version ?? 0) + 1;
  const parameters = [options.recordIdentifier, options.workspaceIdentifier];

  await options.transaction.dbTransaction.query(
    `INSERT INTO cueloop_sync_thread (id, workspace_identifier, thread_identifier, title_preview, status, version, thread_created_at)
     VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7::double precision / 1000))
     ON CONFLICT (id) DO UPDATE SET title_preview = excluded.title_preview, status = excluded.status, version = excluded.version`,
    [
      ...parameters,
      options.thread.id,
      (options.thread.artifact.meta.title ?? "").slice(0, 2000),
      options.thread.status,
      version,
      Date.parse(options.thread.createdAt),
    ],
  );
  await options.transaction.dbTransaction.query(
    `INSERT INTO cueloop_sync_thread_state (id, workspace_identifier, document) VALUES ($1, $2, $3::text::jsonb)
     ON CONFLICT (id) DO UPDATE SET document = excluded.document`,
    [...parameters, document],
  );
  await options.transaction.dbTransaction.query(
    `INSERT INTO cueloop_sync_thread_document (id, workspace_identifier, document, text_state, text_document_identifier, text_revision)
     VALUES ($1, $2, $3::text::jsonb, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET document = excluded.document, text_state = excluded.text_state,
       text_document_identifier = excluded.text_document_identifier, text_revision = excluded.text_revision`,
    [
      ...parameters,
      JSON.stringify(projectSyncThreadForCollaborators(options.thread)),
      text.state,
      text.identifier,
      text.revision,
    ],
  );

  return {
    recordIdentifier: options.recordIdentifier,
    threadIdentifier: options.thread.id,
    version,
  };
}

export async function deleteSyncThread(options: {
  transaction: SyncThreadTransaction;
  recordIdentifier: string;
  workspaceIdentifier: string;
}) {
  for (const table of [
    "cueloop_sync_thread",
    "cueloop_sync_thread_state",
    "cueloop_sync_thread_document",
  ]) {
    await options.transaction.dbTransaction.query(
      `UPDATE ${table} SET deleted_at = now() WHERE id = $1 AND workspace_identifier = $2`,
      [options.recordIdentifier, options.workspaceIdentifier],
    );
  }
}
