import { expect, test } from "bun:test";
import { parseHarnessSelection } from "./harness-selection";

test("harness selection supports launcher and restart without stealing session flags", () => {
  expect(parseHarnessSelection(["--harness", "fx"])).toEqual({ args: [], harness: "fx" });
  expect(parseHarnessSelection(["restart", "--harness=pi"])).toEqual({
    args: ["restart"],
    harness: "pi",
  });
  expect(parseHarnessSelection(["--harness", "fx", "plan", "thread-id"])).toEqual({
    args: ["plan", "thread-id"],
    harness: "fx",
  });
  expect(parseHarnessSelection(["session", "bind-harness", "--harness", "codex"])).toEqual({
    args: ["session", "bind-harness", "--harness", "codex"],
  });
  expect(() => parseHarnessSelection(["restart", "--harness"])).toThrow(
    "--harness pi or --harness fx",
  );
  expect(() => parseHarnessSelection(["--harness=bad"])).toThrow("--harness pi or --harness fx");
  expect(() => parseHarnessSelection(["--harness=pi", "--harness=fx"])).toThrow("only one");
});
