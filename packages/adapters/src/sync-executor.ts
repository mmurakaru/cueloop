import { DaemonClientError, type DaemonClient } from "@cueloop/daemon/client";
import { promptOperationFingerprint } from "@cueloop/daemon/operation-receipts";
import type { AgentPromptRequest, ThreadAgentState } from "@cueloop/schema";
import type {
  SyncExecutionClaim,
  SyncExecutionExecutor,
  SyncExecutionObservation,
} from "@cueloop/sync/execution";
import * as v from "valibot";

const PromptInputSchema = v.strictObject({
  text: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100000)),
  context: v.optional(v.pipe(v.string(), v.maxLength(100000))),
});
const BindingSchema = v.strictObject({
  workspaceIdentifier: v.pipe(v.string(), v.uuid(), v.toLowerCase()),
  targetIdentifier: v.pipe(v.string(), v.uuid(), v.toLowerCase()),
  threadIdentifier: v.pipe(v.string(), v.minLength(1)),
});

function observePromptReceipt(
  state: ThreadAgentState,
  input: AgentPromptRequest,
): SyncExecutionObservation {
  const receipt = state.promptOperations?.find((entry) => entry.operationId === input.operationId);

  if (!receipt) return { status: "absent" };

  if (receipt.fingerprint !== promptOperationFingerprint(input))
    return { status: "failed", message: "Owner prompt identity conflicts with its accepted input" };

  const reference = input.operationId;

  if (receipt.outcome === "completed") return { status: "completed", reference };

  if (receipt.outcome === "failed" || receipt.outcome === "cancelled")
    return {
      status: "failed",
      reference,
      message:
        receipt.outcome === "cancelled" ? "Owner prompt was cancelled" : "Owner prompt failed",
    };

  return { status: "executing", reference };
}

/** Explicit Thread bindings and input-only prompts retain the owner's final message control. */
export function createCueloopSyncExecutor(options: {
  identifier: string;
  client: Pick<DaemonClient, "agentGet" | "agentPrompt">;
  bindings: readonly v.InferOutput<typeof BindingSchema>[];
}): SyncExecutionExecutor {
  const identifier = v.parse(v.pipe(v.string(), v.uuid(), v.toLowerCase()), options.identifier);
  const bindings = new Map<string, string>();

  for (const binding of v.parse(v.array(BindingSchema), options.bindings)) {
    const key = `${binding.workspaceIdentifier}/${binding.targetIdentifier}`;

    if (bindings.has(key)) throw new Error("Sync executor has duplicate Thread bindings");

    bindings.set(key, binding.threadIdentifier);
  }

  const prompt = (claim: SyncExecutionClaim): AgentPromptRequest | undefined => {
    if (claim.action !== "agent.prompt" || claim.executorIdentifier !== identifier) return;

    const threadIdentifier = bindings.get(`${claim.workspaceIdentifier}/${claim.targetIdentifier}`);
    const input = v.safeParse(PromptInputSchema, claim.input);

    if (!threadIdentifier || !input.success) return;

    return {
      id: threadIdentifier,
      ...input.output,
      operationId: claim.operationIdentifier,
      inputOnly: true,
    };
  };
  const unavailable: SyncExecutionObservation = {
    status: "recovery-required",
    message: "Owner request requires a supported action and explicit Thread binding",
  };

  return {
    identifier,
    async recover(claim, signal) {
      const input = prompt(claim);

      if (!input) return unavailable;

      const state = await options.client.agentGet(input.id, { signal });
      const observation = observePromptReceipt(state, input);

      if (observation.status === "absent" && !state.harness)
        return {
          status: "recovery-required",
          message: "Owner Thread has no execution integration",
        };

      const receipt = state.promptOperations?.find(
        (entry) => entry.operationId === input.operationId,
      );

      if (
        observation.status === "executing" &&
        receipt?.result.some((submissionIdentifier) =>
          state.submissions?.some(
            (submission) =>
              submission.id === submissionIdentifier && submission.status === "queued",
          ),
        )
      )
        return observePromptReceipt(await options.client.agentPrompt(input, { signal }), input);

      return observation;
    },
    async dispatch(claim, signal) {
      const input = prompt(claim);

      if (!input) return unavailable;

      try {
        return observePromptReceipt(await options.client.agentPrompt(input, { signal }), input);
      } catch (cause) {
        if (cause instanceof DaemonClientError) {
          const state = await options.client.agentGet(input.id, { signal });
          const observation = observePromptReceipt(state, input);

          return observation.status === "absent"
            ? { status: "failed", message: "Owner daemon rejected the prompt request" }
            : observation;
        }

        throw cause;
      }
    },
  };
}
