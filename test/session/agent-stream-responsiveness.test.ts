import { expect, test } from "bun:test";
import { runTestAgentStreamReview } from "../helpers/agent-stream-review";

test("typing during agent updates preserves the draft without refreshing unrelated Thread data", async () => {
  const result = await runTestAgentStreamReview();

  expect(result.draftPreserved).toBe(true);
  expect(result.streamPreserved).toBe(true);
  expect(result.listReads).toBe(0);
  expect(result.threadReads).toBe(0);
});
