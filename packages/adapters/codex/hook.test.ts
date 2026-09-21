import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodexHook } from "./hook";
import { createCodexSessionRegistry } from "./session-registry";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-codex-hook-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("runCodexHook", () => {
  test("binds a session and overwrites model-supplied identity on open_thread", () => {
    const sessions = createCodexSessionRegistry(home);
    const started = runCodexHook(
      { hook_event_name: "SessionStart", session_id: "codex-1", cwd: "/project" },
      home,
    );

    expect(sessions.list()).toEqual(["codex-1"]);
    expect(started).toHaveProperty("hookSpecificOutput.hookEventName", "SessionStart");
    const rewritten = runCodexHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "codex-1",
        cwd: "/project",
        tool_name: "mcp__cueloop__open_thread",
        tool_input: {
          workflow: "plan",
          content: "# Plan",
          harnessSessionId: "forged",
          cwd: "/elsewhere",
        },
      },
      home,
    );

    expect(rewritten).toHaveProperty("hookSpecificOutput.updatedInput", {
      workflow: "plan",
      content: "# Plan",
      harnessSessionId: "codex-1",
      cwd: "/project",
      hookToken: expect.any(String),
    });
    // SAFETY: The open_thread PreToolUse branch returns updatedInput with a hookToken.
    const updatedInput = (
      rewritten as { hookSpecificOutput: { updatedInput: { hookToken: string } } }
    ).hookSpecificOutput.updatedInput;

    expect(sessions.authorized("codex-1", "/project", updatedInput.hookToken)).toBeTrue();
    expect(sessions.authorized("forged", "/project", updatedInput.hookToken)).toBeFalse();
    expect(sessions.authorized("codex-1", "/elsewhere", updatedInput.hookToken)).toBeFalse();
    runCodexHook({ hook_event_name: "SessionEnd", session_id: "codex-1", cwd: "/project" }, home);
    expect(sessions.list()).toEqual([]);
  });

  test("does not rewrite unrelated tools", () => {
    expect(
      runCodexHook(
        {
          hook_event_name: "PreToolUse",
          session_id: "codex-1",
          cwd: "/project",
          tool_name: "Bash",
          tool_input: { command: "pwd" },
        },
        home,
      ),
    ).toBeUndefined();
  });
});
