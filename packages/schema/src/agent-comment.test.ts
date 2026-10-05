import { expect, test } from "bun:test";
import { agentCommentRoot } from "./agent-comment";
import type { ThreadAgentState } from "./thread-agent";

const state: ThreadAgentState = {
  threadId: "thread",
  phase: { kind: "idle" },
  messages: [],
  tools: [],
  comments: [],
  submissions: [
    { id: "prompt", commentId: "prompt", prompt: "Explain retries", status: "completed" },
  ],
};

test("accepted bottom prompts have quote-primary read-only discussion roots", () => {
  expect(agentCommentRoot(state, "prompt")).toMatchObject({
    id: "prompt",
    messageId: "prompt",
    body: "Explain retries",
    sent: true,
    anchor: { quote: "Explain retries" },
  });
  expect(state.comments).toEqual([]);
  expect(agentCommentRoot(state, "missing")).toBeUndefined();
});
