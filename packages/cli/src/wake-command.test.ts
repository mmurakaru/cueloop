/** cueloop wake argument guards: a missing session id and a codex wake without a thread id both fail with a usage code before any daemon or harness work. */

import { describe, expect, test } from "bun:test";
import { wakeCommand } from "./wake-command";

describe("wakeCommand argument guards", () => {
  test("a missing session id is a usage error", async () => {
    expect(await wakeCommand([])).toBe(2);
  });

  test("a codex wake without a thread id is a usage error", async () => {
    expect(await wakeCommand(["ses_1", "--harness", "codex"])).toBe(2);
  });
});
