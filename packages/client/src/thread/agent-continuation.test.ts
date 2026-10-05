import { expect, test } from "bun:test";
import { agentContinuation, type AgentContinuation } from "./agent-continuation";
import type { ThreadAgentState } from "@cueloop/schema";

const state: ThreadAgentState = {
  threadId: "thread",
  phase: { kind: "idle" },
  messages: [],
  comments: [],
  tools: [],
};

test("only a completed reply in an idle conversation offers continuation", () => {
  expect(agentContinuation(state)).toEqual({ kind: "waiting" });
  const message = {
    id: "answer",
    role: "agent" as const,
    text: "Done",
    complete: true,
    revision: 1,
  };
  const completed: AgentContinuation = agentContinuation({ ...state, messages: [message] });

  expect(completed.kind).toBe("ready");
  if (completed.kind === "ready") expect(completed.replyId).toBe("answer");
  expect(agentContinuation({ ...state, phase: { kind: "running" }, messages: [message] })).toEqual({
    kind: "waiting",
  });
  expect(agentContinuation({ ...state, messages: [{ ...message, complete: false }] })).toEqual({
    kind: "waiting",
  });
});
