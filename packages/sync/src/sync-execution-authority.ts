import { syncTransactionAuthority } from "./sync-authority-context.ts";
import { readSyncWorkspaceAuthority } from "./sync-authority-database.ts";
import { SyncAuthorityFenced } from "./sync-authority-protocol.ts";
import * as v from "valibot";
import type { ReadonlyJSONValue, Schema, ServerTransaction } from "@rocicorp/zero";
import { acceptSyncOperation } from "./sync-operation-receipt.ts";
import { SyncOperationRejection, type SyncOperation } from "./sync-operation.ts";
import { SyncJsonValueSchema } from "./sync-json.ts";
import {
  SyncExecutionClaimSchema,
  SyncExecutionLeaseSchema,
  SyncExecutionObservationSchema,
  type SyncExecutionClaim,
  type SyncExecutionReport,
} from "./sync-execution.ts";

export type SyncExecutionTransaction = Pick<
  ServerTransaction<Schema, unknown>,
  "location" | "dbTransaction"
>;
const IdentifierSchema = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const ExecutionRequestSchema = v.strictObject({
  targetIdentifier: IdentifierSchema,
  action: v.pipe(v.string(), v.minLength(1), v.maxLength(100), v.regex(/^[a-z][a-z0-9_.-]*$/)),
  input: SyncJsonValueSchema,
});

export type SyncExecutionRequestInput = v.InferOutput<typeof ExecutionRequestSchema>;

/** Accepted intent and its receipt commit in the same application transaction. */
export async function acceptSyncExecution<Arguments extends ReadonlyJSONValue, Access>(options: {
  transaction: SyncExecutionTransaction;
  definition: { schema: v.GenericSchema<unknown, SyncOperation<Arguments>> };
  operation: unknown;
  actorIdentifier: string;
  authorize: (
    transaction: SyncExecutionTransaction,
    operation: SyncOperation<Arguments>,
  ) => Promise<Access>;
  prepare: (
    transaction: SyncExecutionTransaction,
    operation: SyncOperation<Arguments>,
    access: Access,
  ) => Promise<SyncExecutionRequestInput>;
}) {
  return acceptSyncOperation({
    ...options,
    apply: async (transaction, operation, access) => {
      const request = v.parse(
        ExecutionRequestSchema,
        await options.prepare(transaction, operation, access),
      );
      const input = JSON.stringify(request.input);

      if (new TextEncoder().encode(input).byteLength > 512 * 1024)
        throw new SyncOperationRejection({
          code: "execution_input_too_large",
          message: "Execution input exceeds its byte budget",
        });

      await transaction.dbTransaction.query(
        "INSERT INTO sync_execution (id, workspace_identifier, target_identifier, requester_identifier, action, input) VALUES ($1, $2, $3, $4, $5, $6::text::jsonb)",
        [
          operation.operationIdentifier,
          operation.workspaceIdentifier,
          request.targetIdentifier,
          options.actorIdentifier,
          request.action,
          input,
        ],
      );

      return { requestIdentifier: operation.operationIdentifier, status: "waiting-owner" };
    },
  });
}

interface ExecutionOwnerAccess {
  workspaceIdentifier: string;
  actorIdentifier: string;
}
interface ExecutionOwnerOptions extends ExecutionOwnerAccess {
  transaction: SyncExecutionTransaction;
  authorize: (transaction: SyncExecutionTransaction, access: ExecutionOwnerAccess) => Promise<void>;
}

async function assertExecutionWorkspace(
  transaction: SyncExecutionTransaction,
  workspaceIdentifier: string,
) {
  const identity = syncTransactionAuthority(transaction);

  if (!identity) return;

  const current = await readSyncWorkspaceAuthority(transaction, workspaceIdentifier);

  if (current.phase !== "active") throw new SyncAuthorityFenced();

  return identity;
}

/** A claim pins its recovery domain and advances the authority fencing token before dispatch. */
export async function claimSyncExecution(
  options: ExecutionOwnerOptions & { executorIdentifier: string },
): Promise<SyncExecutionClaim | null> {
  const workspaceIdentifier = v.parse(IdentifierSchema, options.workspaceIdentifier);
  const executorIdentifier = v.parse(IdentifierSchema, options.executorIdentifier);

  await options.authorize(options.transaction, {
    workspaceIdentifier,
    actorIdentifier: options.actorIdentifier,
  });
  const identity = await assertExecutionWorkspace(options.transaction, workspaceIdentifier);
  const rows = await options.transaction.dbTransaction.query(
    `WITH candidate AS (
      SELECT id FROM sync_execution
      WHERE workspace_identifier = $1 AND deleted_at IS NULL AND NOT recovery_held
        AND status IN ('waiting-owner', 'executing', 'recovery-required')
        AND (executor_identifier IS NULL OR executor_identifier = $2)
        AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
        AND next_check_at <= clock_timestamp() AND fencing_token < 2147483647
      ORDER BY next_check_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE sync_execution AS execution
    SET executor_identifier = $2, lease_identifier = uuidv7(), lease_generation = $3,
      fencing_token = execution.fencing_token + 1,
      lease_expires_at = clock_timestamp() + interval '30 seconds'
    FROM candidate WHERE execution.id = candidate.id
    RETURNING execution.id AS "operationIdentifier", execution.workspace_identifier AS "workspaceIdentifier",
      execution.target_identifier AS "targetIdentifier", execution.requester_identifier AS "requesterIdentifier",
      execution.action, execution.input, execution.executor_identifier AS "executorIdentifier",
      execution.lease_identifier AS "leaseIdentifier", execution.fencing_token AS "fencingToken",
      execution.lease_generation::text AS generation`,
    [workspaceIdentifier, executorIdentifier, identity?.generation ?? null],
  );
  const [claim] = v.parse(v.array(SyncExecutionClaimSchema), [...rows]);

  return claim ?? null;
}

export class SyncExecutionLeaseConflict extends Error {
  constructor() {
    super("Sync execution report does not match its active claim");
    this.name = "SyncExecutionLeaseConflict";
  }
}

/** Reports can retry their own result but cannot overwrite a later claim or a completed observation. */
export async function reportSyncExecution(
  options: ExecutionOwnerOptions & { report: SyncExecutionReport },
): Promise<void> {
  const claim = v.parse(SyncExecutionLeaseSchema, options.report.claim);
  const observation = v.parse(SyncExecutionObservationSchema, options.report.observation);
  const workspaceIdentifier = v.parse(IdentifierSchema, options.workspaceIdentifier);

  if (claim.workspaceIdentifier !== workspaceIdentifier) throw new SyncExecutionLeaseConflict();

  await options.authorize(options.transaction, {
    workspaceIdentifier,
    actorIdentifier: options.actorIdentifier,
  });
  const identity = await assertExecutionWorkspace(options.transaction, workspaceIdentifier);

  if ((claim.generation ?? null) !== (identity?.generation ?? null))
    throw new SyncExecutionLeaseConflict();

  const status = observation.status === "absent" ? "waiting-owner" : observation.status;
  const reference = "reference" in observation ? (observation.reference ?? null) : null;
  const message = "message" in observation ? observation.message : null;
  const rows = await options.transaction.dbTransaction.query(
    `SELECT status, observation_reference, error_message,
      lease_expires_at IS NULL AS reported,
      lease_expires_at > clock_timestamp() AS active
     FROM sync_execution WHERE id = $1 AND workspace_identifier = $2 AND executor_identifier = $3
       AND lease_identifier = $4 AND fencing_token = $5 AND deleted_at IS NULL
       AND NOT recovery_held AND lease_generation IS NOT DISTINCT FROM $6::uuid FOR UPDATE`,
    [
      claim.operationIdentifier,
      workspaceIdentifier,
      claim.executorIdentifier,
      claim.leaseIdentifier,
      claim.fencingToken,
      claim.generation ?? null,
    ],
  );
  const [current] = v.parse(
    v.array(
      v.object({
        status: v.string(),
        observation_reference: v.nullable(v.string()),
        error_message: v.nullable(v.string()),
        reported: v.boolean(),
        active: v.nullable(v.boolean()),
      }),
    ),
    [...rows],
  );

  if (!current) throw new SyncExecutionLeaseConflict();

  if (current.reported) {
    if (
      current.status === status &&
      current.observation_reference === reference &&
      current.error_message === message
    )
      return;

    throw new SyncExecutionLeaseConflict();
  }

  if (!current.active) throw new SyncExecutionLeaseConflict();

  const updated = await options.transaction.dbTransaction.query(
    "UPDATE sync_execution SET status = $2, observation_reference = $3, error_message = $4, lease_expires_at = NULL, next_check_at = clock_timestamp() + interval '1 second' WHERE id = $1 AND lease_expires_at > clock_timestamp() RETURNING id",
    [claim.operationIdentifier, status, reference, message],
  );

  if ([...updated].length !== 1) throw new SyncExecutionLeaseConflict();
}
