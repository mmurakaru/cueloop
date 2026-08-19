/**
 * The hook's hard guarantee: whatever goes wrong inside cueloop, the
 * agent gets a valid hook response. A silent crash would read to the agent as
 * a broken permission gate.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const HOOK = join(import.meta.dir, "..", "..", "packages", "adapters", "claude-code", "hook.ts");

async function runHookProcess(
  env: Record<string, string>,
  payload: string,
): Promise<{ out: string; code: number }> {
  const proc = Bun.spawn([process.execPath, "run", HOOK], {
    env: { ...process.env, ...env },
    stdin: new TextEncoder().encode(payload),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { out, code };
}

describe("hook resilience", () => {
  test("an unreachable daemon still yields a valid allow response", async () => {
    // Act
    // point the home at a path that cannot host a socket, and make the start
    // deadline tiny so the failure is fast and deterministic
    const { out, code } = await runHookProcess(
      { CUELOOP_HOME: "/proc/nonexistent-cueloop-home", CUELOOP_START_TIMEOUT_MS: "300" },
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "resilience-1",
        cwd: process.cwd(),
        tool_name: "ExitPlanMode",
        tool_input: { plan: "# Plan\n\nDo something.\n" },
      }),
    );

    // Assert
    expect(code).toBe(0);
    const parsed = JSON.parse(out.trim()) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("cueloop unavailable");
  }, 60_000);

  test("an unparseable payload yields a valid response too", async () => {
    // Act
    const { out, code } = await runHookProcess({}, "not json at all");

    // Assert
    expect(code).toBe(0);
    // no event name in the payload, so the answer uses the PermissionRequest shape
    const parsed = JSON.parse(out.trim()) as { decision?: { behavior?: string } };
    expect(parsed.decision?.behavior).toBe("allow");
  }, 60_000);

  test("an event without a plan passes through untouched", async () => {
    // Act
    const { out } = await runHookProcess(
      {},
      JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }),
    );

    // Assert
    const parsed = JSON.parse(out.trim()) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain("no plan payload");
  }, 60_000);
});
