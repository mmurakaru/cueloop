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
      status: "pending";
      operationIdentifier: SyncOperation["operationIdentifier"];
      workspaceIdentifier: string;
    };

/** A missing acknowledgement remains pending and never triggers an automatic resubmission. */
export async function submitSyncOperation<Operation extends SyncOperation>(options: {
  operation: Operation;
  submit: (operation: Operation) => MutatorResult;
  lookup?: (operation: Operation) => Promise<SyncOperationReceipt | undefined>;
  acknowledgementTimeoutMilliseconds?: number;
  signal?: AbortSignal;
}): Promise<SyncOperationOutcome> {
  const operation = structuredClone(options.operation);
  const timeoutMilliseconds = v.parse(
    v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(2147483647)),
    options.acknowledgementTimeoutMilliseconds ?? 30000,
  );
  const pending: SyncOperationOutcome = {
    status: "pending",
    operationIdentifier: operation.operationIdentifier,
    workspaceIdentifier: operation.workspaceIdentifier,
  };

  parseSyncOperation(operation);

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
