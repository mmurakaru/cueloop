import type { ThreadAgentState } from "@cueloop/schema";

/** Chat continuation names a completed reply only when the harness has returned to idle. */
export type AgentContinuation = { kind: "waiting" } | { kind: "ready"; replyId: string };

/** Streaming replies cannot request the next prompt's focus. */
export function agentContinuation(state: ThreadAgentState): AgentContinuation {
  const reply = state.messages.findLast((message) => message.role === "agent");

  if (state.phase.kind !== "idle" || !reply?.complete) return { kind: "waiting" };

  return { kind: "ready", replyId: reply.id };
}
