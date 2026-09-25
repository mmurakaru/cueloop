import { expect, test } from "bun:test";
import { manualThreadOpenCommand } from "./thread-surface";

test("manual Thread command uses the shared harness wording", () => {
  expect(manualThreadOpenCommand("ses_123")).toBe("Open cueloop threads: cueloop ses_123");
});
