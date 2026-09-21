import { expect, test } from "bun:test";
import { join } from "node:path";

test("Claude Mod fallback blocks without a Bun runtime", async () => {
  const child = Bun.spawn(["sh", join(import.meta.dir, "capability-guard.sh")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(child.stdout).json();

  expect(await child.exited).toBe(0);
  expect(output).toMatchObject({ decision: "block" });
  expect(output.reason).toContain("Claude Code 2.1.278 or newer");
});
