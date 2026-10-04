import { expect, test } from "bun:test";
import { agentInputTarget } from "./agent-input";

test("typing targets a prompt, a marked comment, or neither", () => {
  expect(agentInputTarget(true, false)).toBe("prompt");
  expect(agentInputTarget(true, true)).toBe("prompt");
  expect(agentInputTarget(false, true)).toBe("comment");
  expect(agentInputTarget(false, false)).toBe("none");
});
