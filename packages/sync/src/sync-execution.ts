import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import * as v from "valibot";
import { SyncOperationIdentifierSchema } from "./sync-operation.ts";
import { SyncJsonValueSchema } from "./sync-json.ts";

const ExecutionIdentifierSchema = v.pipe(v.string(), v.uuid(), v.toLowerCase());
const ExecutionReferenceSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
const ExecutionMessageSchema = v.pipe(v.string(), v.minLength(1), v.maxLength(1000));
const ExecutionInputSchema = v.pipe(
  SyncJsonValueSchema,
  v.check(
    (input) => new TextEncoder().encode(JSON.stringify(input)).byteLength <= 512 * 1024,
    "Sync execution input exceeds its byte budget",
  ),
);

export const SyncExecutionClaimSchema = v.strictObject({
  operationIdentifier: SyncOperationIdentifierSchema,
  workspaceIdentifier: ExecutionIdentifierSchema,
  targetIdentifier: ExecutionIdentifierSchema,
  requesterIdentifier: ExecutionReferenceSchema,
  action: v.pipe(v.string(), v.minLength(1), v.maxLength(100), v.regex(/^[a-z][a-z0-9_.-]*$/)),
  input: ExecutionInputSchema,
  executorIdentifier: ExecutionIdentifierSchema,
  leaseIdentifier: ExecutionIdentifierSchema,
  generation: v.optional(v.nullable(ExecutionIdentifierSchema)),
  fencingToken: v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(2147483647)),
});
export const SyncExecutionLeaseSchema = v.pick(v.object(SyncExecutionClaimSchema.entries), [
  "operationIdentifier",
  "workspaceIdentifier",
  "executorIdentifier",
  "leaseIdentifier",
  "fencingToken",
  "generation",
]);

export type SyncExecutionLease = Readonly<v.InferOutput<typeof SyncExecutionLeaseSchema>>;
export type SyncExecutionClaim = Readonly<v.InferOutput<typeof SyncExecutionClaimSchema>>;
export const SyncExecutionObservationSchema = v.variant("status", [
  v.strictObject({ status: v.literal("absent") }),
  v.strictObject({
    status: v.literal("executing"),
    reference: v.optional(ExecutionReferenceSchema),
  }),
  v.strictObject({
    status: v.literal("completed"),
    reference: v.optional(ExecutionReferenceSchema),
  }),
  v.strictObject({
    status: v.literal("failed"),
    reference: v.optional(ExecutionReferenceSchema),
    message: ExecutionMessageSchema,
  }),
  v.strictObject({ status: v.literal("recovery-required"), message: ExecutionMessageSchema }),
]);

export type SyncExecutionObservation = v.InferOutput<typeof SyncExecutionObservationSchema>;
export interface SyncExecutionReport {
  claim: SyncExecutionLease;
  observation: SyncExecutionObservation;
}

/** Dispatch must use the operation identity idempotently within one stable provider recovery domain. */
export interface SyncExecutionExecutor {
  identifier: string;
  recover(claim: SyncExecutionClaim, signal?: AbortSignal): Promise<SyncExecutionObservation>;
  dispatch(claim: SyncExecutionClaim, signal?: AbortSignal): Promise<SyncExecutionObservation>;
  close?: () => void | Promise<void>;
}

/** Applications authorize claims and reject stale lease identities and fencing tokens on reports. */
export interface SyncExecutionQueue {
  claim(options: {
    executorIdentifier: string;
    signal?: AbortSignal;
  }): Promise<SyncExecutionClaim | null>;
  report(report: SyncExecutionReport, signal?: AbortSignal): Promise<void>;
}

export class SyncExecutionAuthorityError extends Error {
  constructor(readonly statusCode?: number) {
    super(
      statusCode === undefined
        ? "Sync execution authority is unavailable"
        : `Sync execution request failed with HTTP ${statusCode}`,
    );
    this.name = "SyncExecutionAuthorityError";
  }

  get recoverable(): boolean {
    return (
      this.statusCode === undefined ||
      [408, 409, 425, 429].includes(this.statusCode) ||
      this.statusCode >= 500
    );
  }
}

async function recoverSyncExecution(
  executor: SyncExecutionExecutor,
  claim: SyncExecutionClaim,
  signal?: AbortSignal,
  telemetry: SyncTelemetry = getSyncTelemetry(),
): Promise<SyncExecutionObservation> {
  const span = telemetry.start("execution.recover");

  try {
    const observation = v.parse(
      SyncExecutionObservationSchema,
      await span.run(() => executor.recover(claim, signal)),
    );

    span.end(observation.status);

    return observation;
  } catch {
    span.end("recovery-required");

    return {
      status: "recovery-required",
      message: "Execution integration recovery is unavailable",
    };
  }
}

/** Recovery must prove absence before dispatch; an uncertain acknowledgement always returns to recovery. */
export async function advanceSyncExecution(options: {
  queue: SyncExecutionQueue;
  executor: SyncExecutionExecutor;
  signal?: AbortSignal;
  telemetry?: SyncTelemetry;
}): Promise<SyncExecutionReport | undefined> {
  const telemetry = options.telemetry ?? getSyncTelemetry();

  options.signal?.throwIfAborted();
  const executorIdentifier = v.parse(ExecutionIdentifierSchema, options.executor.identifier);
  const received = await options.queue.claim({ executorIdentifier, signal: options.signal });

  if (!received) return;

  const claim = v.parse(SyncExecutionClaimSchema, received);

  if (claim.executorIdentifier !== executorIdentifier)
    throw new Error("Sync execution claim belongs to a different recovery domain");

  let observation = await recoverSyncExecution(options.executor, claim, options.signal, telemetry);

  options.signal?.throwIfAborted();

  if (observation.status === "absent") {
    const span = telemetry.start("execution.dispatch");

    try {
      observation = v.parse(
        SyncExecutionObservationSchema,
        await span.run(() => options.executor.dispatch(claim, options.signal)),
      );
      span.end(observation.status);
    } catch {
      span.end("recovery-required");
      observation = await recoverSyncExecution(options.executor, claim, options.signal, telemetry);
    }
  }

  options.signal?.throwIfAborted();
  const report = { claim: v.parse(SyncExecutionLeaseSchema, claim), observation };

  await options.queue.report(report, options.signal);

  return report;
}

export const SyncExecutionRequestSchema = v.variant("action", [
  v.strictObject({
    action: v.literal("claim"),
    workspaceIdentifier: ExecutionIdentifierSchema,
    executorIdentifier: ExecutionIdentifierSchema,
  }),
  v.strictObject({
    action: v.literal("report"),
    claim: SyncExecutionLeaseSchema,
    observation: SyncExecutionObservationSchema,
  }),
]);
