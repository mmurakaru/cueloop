import { createHash } from "node:crypto";
import serialize from "canonicalize";
import * as v from "valibot";
import type { ReadonlyJSONValue, Schema, ServerTransaction } from "@rocicorp/zero";
import {
  parseSyncOperation,
  SyncOperationReceiptSchema,
  SyncOperationConflict,
  SyncOperationRejection,
  type SyncOperation,
  type SyncOperationReceipt,
} from "./sync-operation.ts";
import { SyncJsonValueSchema } from "./sync-json.ts";

const DEFAULT_RESULT_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const MAXIMUM_RESULT_BYTES = 512 * 1024;

type OperationTransaction = Pick<ServerTransaction<Schema, unknown>, "location" | "dbTransaction">;
interface OperationReceiptContext<Arguments extends ReadonlyJSONValue = ReadonlyJSONValue> {
  transaction: OperationTransaction;
  operation: SyncOperation<Arguments>;
  actorIdentifier: string;
  fingerprint: string;
  now: number;
  retainedUntil: number;
}

const ReceiptRowSchema = v.object({
  operation_identifier: v.string(),
  workspace_identifier: v.string(),
  actor_identifier: v.string(),
  fingerprint: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
  status: v.picklist(["accepted", "rejected"]),
  accepted_at: v.nullable(v.pipe(v.number(), v.safeInteger())),
  rejected_at: v.nullable(v.pipe(v.number(), v.safeInteger())),
  result_retained_until: v.pipe(v.number(), v.safeInteger()),
  compacted: v.boolean(),
  result: SyncJsonValueSchema,
  rejection_code: v.nullable(v.string()),
  rejection_message: v.nullable(v.string()),
});

function operationFingerprint(operation: SyncOperation, actorIdentifier: string) {
  const canonical = serialize({ operation, actorIdentifier });

  if (canonical === undefined) throw new Error("Sync operation cannot be fingerprinted");

  return createHash("sha256").update(canonical).digest("hex");
}

function validateOperationResult(result: ReadonlyJSONValue): ReadonlyJSONValue {
  const validated = v.parse(SyncJsonValueSchema, result);
  const serialized = JSON.stringify(validated);

  if (new TextEncoder().encode(serialized).byteLength > MAXIMUM_RESULT_BYTES) {
    throw new Error("Sync operation result exceeds 512 KiB");
  }

  return validated;
}

async function readOperationReceipt(
  context: Omit<OperationReceiptContext, "retainedUntil">,
): Promise<SyncOperationReceipt | undefined> {
  const rows = await context.transaction.dbTransaction.query(
    `SELECT operation_identifier::text, workspace_identifier::text, actor_identifier, fingerprint, status,
      (extract(epoch FROM accepted_at) * 1000)::double precision AS accepted_at,
      (extract(epoch FROM rejected_at) * 1000)::double precision AS rejected_at,
      (extract(epoch FROM result_retained_until) * 1000)::double precision AS result_retained_until,
      compacted_at IS NOT NULL AS compacted, result, rejection_code, rejection_message
     FROM sync_operation_receipt WHERE operation_identifier = $1`,
    [context.operation.operationIdentifier],
  );
  const [input] = [...rows];

  if (!input) return undefined;

  const row = v.parse(ReceiptRowSchema, input);

  if (
    row.workspace_identifier !== context.operation.workspaceIdentifier ||
    row.actor_identifier !== context.actorIdentifier ||
    row.fingerprint !== context.fingerprint
  ) {
    throw new SyncOperationConflict();
  }

  const expired = row.compacted || row.result_retained_until <= context.now;
  const metadata = {
    operationIdentifier: row.operation_identifier,
    workspaceIdentifier: row.workspace_identifier,
  };

  if (row.status === "rejected") {
    return v.parse(SyncOperationReceiptSchema, {
      ...metadata,
      status: "rejected",
      rejectedAt: row.rejected_at,
      reason: expired
        ? { status: "expired" }
        : { status: "retained", code: row.rejection_code, message: row.rejection_message },
    });
  }

  return v.parse(SyncOperationReceiptSchema, {
    ...metadata,
    status: "accepted",
    acceptedAt: row.accepted_at,
    result: expired
      ? { status: "expired" }
      : { status: "retained", value: validateOperationResult(row.result) },
  });
}

async function persistOperationRejection(
  context: OperationReceiptContext,
  rejection: SyncOperationRejection,
): Promise<SyncOperationReceipt> {
  const { operation } = context;

  await context.transaction.dbTransaction.query(
    `INSERT INTO sync_operation_receipt
      (operation_identifier, workspace_identifier, actor_identifier, operation_name, operation_version,
       fingerprint, request_created_at, request_expires_at, status, rejected_at,
       result_retained_until, rejection_code, rejection_message)
     VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7::double precision / 1000),
       to_timestamp($8::double precision / 1000), 'rejected', to_timestamp($9::double precision / 1000),
       to_timestamp($10::double precision / 1000), $11, $12)`,
    [
      operation.operationIdentifier,
      operation.workspaceIdentifier,
      context.actorIdentifier,
      operation.name,
      operation.version,
      context.fingerprint,
      operation.createdAt,
      operation.expiresAt,
      context.now,
      context.retainedUntil,
      rejection.code,
      rejection.message,
    ],
  );

  return v.parse(SyncOperationReceiptSchema, {
    status: "rejected",
    operationIdentifier: operation.operationIdentifier,
    workspaceIdentifier: operation.workspaceIdentifier,
    rejectedAt: context.now,
    reason: { status: "retained", code: rejection.code, message: rejection.message },
  });
}

/** Receipts commit with the caller's transaction; callbacks must contain only transactional work. */
export async function acceptSyncOperation<
  Arguments extends ReadonlyJSONValue,
  ApplicationTransaction extends OperationTransaction,
  Access,
>(options: {
  transaction: ApplicationTransaction;
  definition: { schema: v.GenericSchema<unknown, SyncOperation<Arguments>> };
  operation: unknown;
  actorIdentifier: string;
  authorize(
    transaction: ApplicationTransaction,
    operation: SyncOperation<Arguments>,
  ): Promise<Access>;
  apply(
    transaction: ApplicationTransaction,
    operation: SyncOperation<Arguments>,
    access: Access,
  ): Promise<ReadonlyJSONValue>;
  now?: () => number;
  resultRetentionMilliseconds?: number;
}): Promise<SyncOperationReceipt> {
  const operation = v.parse(options.definition.schema, options.operation);

  parseSyncOperation(operation);
  const actorIdentifier = v.parse(
    v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
    options.actorIdentifier,
  );
  const retention = v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    options.resultRetentionMilliseconds ?? DEFAULT_RESULT_RETENTION_MILLISECONDS,
  );
  const fingerprint = operationFingerprint(operation, actorIdentifier);

  await options.transaction.dbTransaction.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    [`cueloop-sync-operation:${operation.operationIdentifier}`],
  );
  const access = await options.authorize(options.transaction, operation);
  const now = v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    options.now?.() ?? Date.now(),
  );
  const retainedUntil = v.parse(v.pipe(v.number(), v.safeInteger()), now + retention);
  const context = {
    transaction: options.transaction,
    operation,
    actorIdentifier,
    fingerprint,
    now,
    retainedUntil,
  };
  const existing = await readOperationReceipt(context);

  if (existing) return existing;

  if (operation.expiresAt <= now) {
    return persistOperationRejection(
      context,
      new SyncOperationRejection({
        code: "request_expired",
        message: "Sync operation request expired before acceptance",
      }),
    );
  }

  await options.transaction.dbTransaction.query("SAVEPOINT cueloop_sync_operation", []);
  let result: ReadonlyJSONValue;

  try {
    result = validateOperationResult(await options.apply(options.transaction, operation, access));
  } catch (cause) {
    if (!(cause instanceof SyncOperationRejection)) throw cause;

    await options.transaction.dbTransaction.query(
      "ROLLBACK TO SAVEPOINT cueloop_sync_operation",
      [],
    );
    await options.transaction.dbTransaction.query("RELEASE SAVEPOINT cueloop_sync_operation", []);

    return persistOperationRejection(context, cause);
  }

  await options.transaction.dbTransaction.query("RELEASE SAVEPOINT cueloop_sync_operation", []);
  await options.transaction.dbTransaction.query(
    `INSERT INTO sync_operation_receipt
      (operation_identifier, workspace_identifier, actor_identifier, operation_name, operation_version,
       fingerprint, request_created_at, request_expires_at, status, accepted_at, result_retained_until, result)
     VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7::double precision / 1000),
       to_timestamp($8::double precision / 1000), 'accepted', to_timestamp($9::double precision / 1000),
       to_timestamp($10::double precision / 1000), $11::text::jsonb)`,
    [
      operation.operationIdentifier,
      operation.workspaceIdentifier,
      actorIdentifier,
      operation.name,
      operation.version,
      fingerprint,
      operation.createdAt,
      operation.expiresAt,
      now,
      retainedUntil,
      JSON.stringify(result),
    ],
  );

  return v.parse(SyncOperationReceiptSchema, {
    status: "accepted",
    operationIdentifier: operation.operationIdentifier,
    workspaceIdentifier: operation.workspaceIdentifier,
    acceptedAt: now,
    result: { status: "retained", value: result },
  });
}

/** Receipt recovery checks current access and the full immutable request before returning a result. */
export async function findSyncOperationReceipt<
  Arguments extends ReadonlyJSONValue,
  ApplicationTransaction extends OperationTransaction,
>(options: {
  transaction: ApplicationTransaction;
  definition: { schema: v.GenericSchema<unknown, SyncOperation<Arguments>> };
  operation: unknown;
  actorIdentifier: string;
  authorize(
    transaction: ApplicationTransaction,
    operation: SyncOperation<Arguments>,
  ): Promise<void>;
  now?: () => number;
}): Promise<SyncOperationReceipt | undefined> {
  const operation = v.parse(options.definition.schema, options.operation);

  parseSyncOperation(operation);
  const actorIdentifier = v.parse(
    v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
    options.actorIdentifier,
  );

  await options.authorize(options.transaction, operation);
  const now = v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    options.now?.() ?? Date.now(),
  );

  return readOperationReceipt({
    transaction: options.transaction,
    operation,
    actorIdentifier,
    fingerprint: operationFingerprint(operation, actorIdentifier),
    now,
  });
}

/** Compaction keeps request identities and acceptance or rejection metadata reserved indefinitely. */
export async function compactSyncOperationResults<
  ApplicationTransaction extends OperationTransaction,
>(options: {
  transaction: ApplicationTransaction;
  workspaceIdentifier: string;
  authorize(transaction: ApplicationTransaction, workspaceIdentifier: string): Promise<void>;
  now?: () => number;
  limit?: number;
}): Promise<number> {
  const workspaceIdentifier = v.parse(
    v.pipe(v.string(), v.uuid(), v.toLowerCase()),
    options.workspaceIdentifier,
  );
  const limit = v.parse(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
    options.limit ?? 100,
  );

  await options.authorize(options.transaction, workspaceIdentifier);
  const now = v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    options.now?.() ?? Date.now(),
  );
  const compacted = await options.transaction.dbTransaction.query(
    `WITH expired AS (
       SELECT id FROM sync_operation_receipt
       WHERE workspace_identifier = $1 AND result_retained_until <= to_timestamp($2::double precision / 1000)
         AND compacted_at IS NULL
       ORDER BY result_retained_until, id LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     UPDATE sync_operation_receipt AS receipt
     SET result = NULL, rejection_code = NULL, rejection_message = NULL,
       compacted_at = to_timestamp($2::double precision / 1000)
     FROM expired WHERE receipt.id = expired.id
     RETURNING receipt.operation_identifier`,
    [workspaceIdentifier, now, limit],
  );

  return [...compacted].length;
}
