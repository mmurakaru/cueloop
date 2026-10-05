import { expect, test } from "bun:test";
import { stepAgentSubmission, type AgentSubmissionStatus } from "./agent-submission";

test("an accepted submission stays locked through failure and retry", () => {
  expect(stepAgentSubmission("draft", "submit", false)).toBe("draft");
  let state: AgentSubmissionStatus = stepAgentSubmission("draft", "submit", true);

  for (const event of ["start", "fail", "retry", "start", "complete"] as const) {
    state = stepAgentSubmission(state, event, true);
    expect(state).not.toBe("draft");
    expect(stepAgentSubmission(state, "edit", true)).toBe(state);
  }
  expect(state).toBe("completed");
  expect(stepAgentSubmission(state, "retry", true)).toBe("completed");
});
