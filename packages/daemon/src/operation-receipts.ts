import type { ThreadAgentState, OperationReceipt, AgentPromptRequest } from "@cueloop/schema";
import { createHash } from "node:crypto";
import { DaemonError } from "./errors";

/** Hash normalized payloads rather than persisting another copy of private input. */
export function operationFingerprint(
  payload: readonly (string | null | readonly (readonly [string, string])[])[],
): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** A duplicate returns its original acceptance even after later operations or restart. */
export function findOperationReceipt<Result>(
  receipts: readonly OperationReceipt<Result>[] | undefined,
  operationId: string | undefined,
  fingerprint: string,
): OperationReceipt<Result> | undefined {
  if (!operationId) return;
  const receipt = receipts?.find((entry) => entry.operationId === operationId);

  if (receipt && receipt.fingerprint !== fingerprint)
    throw new DaemonError(
      "operation_conflict",
      "Operation payload conflict: use a new operation ID for changed input",
    );
  if (!receipt && (receipts?.length ?? 0) >= 128)
    throw new DaemonError(
      "operation_capacity",
      "Operation receipt capacity: create a new Thread before submitting more operations",
    );

  return receipt;
}

/** Each accepted prompt freezes the original batch before it can start a harness turn. */
export function recordPromptOperation(
  state: ThreadAgentState,
  before: ThreadAgentState,
  input: AgentPromptRequest,
): void {
  if (!input.operationId) return;
  const previous = new Set(before.submissions?.map((entry) => entry.id));
  const accepted = input.retry
    ? [input.retry]
    : (state.submissions ?? []).filter((entry) => !previous.has(entry.id)).map((entry) => entry.id);

  if (!accepted.length) throw new DaemonError("invalid_params", "Agent operation requires input");
  const fingerprint = promptOperationFingerprint(input);
  (state.promptOperations ??= []).push({
    operationId: input.operationId,
    fingerprint,
    result: accepted,
  });
}

/** Completion is an immutable fact about acceptance, including across explicit retries. */
export function settlePromptOperations(state: ThreadAgentState): void {
  for (const receipt of state.promptOperations ?? []) {
    if (receipt.outcome || !receipt.result.length) continue;
    const submissions = receipt.result.map((id) =>
      state.submissions?.find((entry) => entry.id === id),
    );

    if (
      submissions.some((entry) => !entry || entry.status === "queued" || entry.status === "running")
    )
      continue;
    receipt.outcome = submissions.some((entry) => entry?.cancelled)
      ? "cancelled"
      : submissions.some((entry) => entry?.status === "failed")
        ? "failed"
        : "completed";
  }
}

/** Prompt identity hashes only explicit input; a retry does not consume newly pending comments. */
export function findPromptOperationReceipt(
  state: ThreadAgentState,
  input: AgentPromptRequest,
): OperationReceipt<string[]> | undefined {
  return findOperationReceipt(
    state.promptOperations,
    input.operationId,
    promptOperationFingerprint(input),
  );
}

function promptOperationFingerprint(input: AgentPromptRequest): string {
  return operationFingerprint([input.text, input.context ?? null, input.retry ?? null]);
}
