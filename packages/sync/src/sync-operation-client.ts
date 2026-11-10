import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import { SyncAuthorityRecoveryRequired } from "./sync-authority-protocol.ts";
import type { MutatorResult } from "@rocicorp/zero";
import * as v from "valibot";
import {
  parseSyncOperation,
  SyncOperationReceiptSchema,
  SyncOperationConflict,
  type SyncOperation,
  type SyncOperationReceipt,
} from "./sync-operation.ts";

export type SyncOperationOutcome =
  | SyncOperationReceipt
  | {
      status: "recovery-required";
      reason: "unknown-after-recovery";
      operationIdentifier: SyncOperation["operationIdentifier"];
      workspaceIdentifier: string;
    }
  | {
      status: "pending";
      operationIdentifier: SyncOperation["operationIdentifier"];
      workspaceIdentifier: string;
    };

interface SyncOperationLookupOptions<Operation extends SyncOperation> {
  operation: Operation;
  lookup: (operation: Operation) => Promise<SyncOperationReceipt | undefined>;
  telemetry?: SyncTelemetry;
}

interface SyncOperationSubmissionOptions<Operation extends SyncOperation> {
  operation: Operation;
  submit: (operation: Operation) => MutatorResult;
  lookup?: (operation: Operation) => Promise<SyncOperationReceipt | undefined>;
  acknowledgementTimeoutMilliseconds?: number;
  signal?: AbortSignal;
  telemetry?: SyncTelemetry;
}

async function observeSyncOperationOutcome(
  telemetry: SyncTelemetry,
  boundary: "operation.submit" | "operation.lookup",
  operation: () => Promise<SyncOperationOutcome>,
): Promise<SyncOperationOutcome> {
  const observation = telemetry.start(boundary);

  try {
    const outcome = await observation.run(operation);

    observation.end(outcome.status);

    return outcome;
  } catch (cause) {
    observation.end(cause instanceof SyncOperationConflict ? "conflict" : "failed");

    throw cause;
  }
}

/** Receipt recovery never submits or changes an envelope, including outside a restored boundary. */
export function lookupSyncOperationOutcome<Operation extends SyncOperation>(
  options: SyncOperationLookupOptions<Operation>,
): Promise<SyncOperationOutcome> {
  return observeSyncOperationOutcome(
    options.telemetry ?? getSyncTelemetry(),
    "operation.lookup",
    () => recoverSyncOperationOutcome(options),
  );
}

/** A missing acknowledgement remains pending and never triggers an automatic resubmission. */
export function submitSyncOperation<Operation extends SyncOperation>(
  options: SyncOperationSubmissionOptions<Operation>,
): Promise<SyncOperationOutcome> {
  return observeSyncOperationOutcome(
    options.telemetry ?? getSyncTelemetry(),
    "operation.submit",
    () => sendSyncOperationEnvelope(options),
  );
}

async function recoverSyncOperationOutcome<Operation extends SyncOperation>(
  options: SyncOperationLookupOptions<Operation>,
): Promise<SyncOperationOutcome> {
  const operation = structuredClone(options.operation);
  const normalized = parseSyncOperation(operation);

  operation.operationIdentifier = normalized.operationIdentifier;
  operation.workspaceIdentifier = normalized.workspaceIdentifier;
  const pending: SyncOperationOutcome = {
    status: "pending",
    operationIdentifier: operation.operationIdentifier,
    workspaceIdentifier: operation.workspaceIdentifier,
  };

  try {
    const input = await options.lookup(structuredClone(operation));

    if (input === undefined) return pending;

    const receipt = v.parse(SyncOperationReceiptSchema, input);

    if (
      receipt.operationIdentifier !== operation.operationIdentifier ||
      receipt.workspaceIdentifier !== operation.workspaceIdentifier
    )
      return pending;

    return receipt;
  } catch (cause) {
    if (cause instanceof SyncAuthorityRecoveryRequired)
      return { ...pending, status: "recovery-required", reason: "unknown-after-recovery" };

    throw cause;
  }
}

async function sendSyncOperationEnvelope<Operation extends SyncOperation>(
  options: SyncOperationSubmissionOptions<Operation>,
): Promise<SyncOperationOutcome> {
  const operation = structuredClone(options.operation);
  const normalized = parseSyncOperation(operation);

  operation.operationIdentifier = normalized.operationIdentifier;
  operation.workspaceIdentifier = normalized.workspaceIdentifier;
  const timeoutMilliseconds = v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(2147483647)),
    options.acknowledgementTimeoutMilliseconds ?? 30000,
  );
  const pending: SyncOperationOutcome = {
    status: "pending",
    operationIdentifier: operation.operationIdentifier,
    workspaceIdentifier: operation.workspaceIdentifier,
  };

  const recoveryRequired: SyncOperationOutcome = {
    ...pending,
    status: "recovery-required",
    reason: "unknown-after-recovery",
  };

  if (options.signal?.aborted) return pending;

  const interrupted = Promise.withResolvers<SyncOperationOutcome>();
  const expire = () => interrupted.resolve(pending);
  const timer = setTimeout(expire, timeoutMilliseconds);

  options.signal?.addEventListener("abort", expire, { once: true });

  const receiveReceipt = async (): Promise<SyncOperationOutcome> => {
    try {
      const result = await options.submit(operation).server;

      if (
        result.type === "error" &&
        result.error.type === "app" &&
        v.is(v.object({ name: v.literal("SyncOperationConflict") }), result.error.details)
      )
        throw new SyncOperationConflict();

      if (
        result.type === "error" &&
        result.error.type === "app" &&
        v.is(v.object({ name: v.literal("SyncAuthorityRecoveryRequired") }), result.error.details)
      )
        return recoveryRequired;

      const input =
        result.type === "success" && result.data !== undefined
          ? result.data
          : await options.lookup?.(structuredClone(operation));

      if (input === undefined) return pending;

      const receipt = v.parse(SyncOperationReceiptSchema, input);

      if (
        receipt.operationIdentifier !== operation.operationIdentifier ||
        receipt.workspaceIdentifier !== operation.workspaceIdentifier
      )
        return pending;

      return receipt;
    } catch (cause) {
      if (cause instanceof SyncAuthorityRecoveryRequired) return recoveryRequired;

      if (cause instanceof SyncOperationConflict) throw cause;

      return pending;
    }
  };

  try {
    return await Promise.race([receiveReceipt(), interrupted.promise]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", expire);
  }
}
