/**
 * The slice-1 e2e (#17): agent → daemon → TUI → verdict → agent, with
 * every party real - the hook runs as a subprocess reading stdin like
 * Claude Code spawns it, the daemon autostarts from the hook, and the
 * reviewer drives the actual App in a virtual terminal.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { DaemonClient } from "@cueloop/daemon/client";
import { App } from "../../packages/client/src/App";

const HOOK = join(import.meta.dir, "..", "..", "packages", "adapters", "claude-code", "hook.ts");

const PLAN = `# Rollout Plan

## Phase 1

Ship the daemon behind a flag.

## Phase 2

Enable it for everyone immediately.
`;

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-e2e-"));
});
afterAll(async () => {
  try {
    const c = await DaemonClient.connect({ home });
    await c.shutdown();
    c.close();
  } catch {
    // daemon already gone
  }
  rmSync(home, { recursive: true, force: true });
});

interface HookRun {
  proc: ReturnType<typeof Bun.spawn>;
  result: Promise<{ decision: string; reason: string }>;
}

function spawnHook(plan: string, waitMs: number): HookRun {
  const event = {
    hook_event_name: "PreToolUse",
    session_id: "cc-session-1",
    cwd: home,
    tool_name: "ExitPlanMode",
    tool_input: { plan },
  };
  const proc = Bun.spawn([process.execPath, "run", HOOK], {
    env: { ...process.env, CUELOOP_HOME: home, CUELOOP_WAIT_MS: String(waitMs), CUELOOP_IDLE_EXIT_MS: "0" },
    stdin: new TextEncoder().encode(JSON.stringify(event)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const result = (async () => {
    const out = await new Response(proc.stdout).text();
    const parsed = JSON.parse(out.trim()) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    return {
      decision: parsed.hookSpecificOutput.permissionDecision,
      reason: parsed.hookSpecificOutput.permissionDecisionReason,
    };
  })();
  return { proc, result };
}

async function waitForPendingSession(): Promise<string> {
  const client = await DaemonClient.connect({ home, autostart: true });
  try {
    for (let i = 0; i < 100; i++) {
      const pending = await client.sessionList({ status: "pending" });
      if (pending.length) return pending[0]!.id;
      await Bun.sleep(50);
    }
    throw new Error("hook never created a session");
  } finally {
    client.close();
  }
}

describe("slice 1: Claude Code plan round-trip", () => {
  test("deny path: reviewer annotates and requests changes; hook relays feedback.md", async () => {
    const hook = spawnHook(PLAN, 30_000);
    const sessionId = await waitForPendingSession();

    // the reviewer opens the session in the real TUI
    const setup = await testRender(<App home={home} sessionId={sessionId} />, { width: 120, height: 30 });
    for (let i = 0; i < 40 && !setup.captureCharFrame().includes("Rollout Plan"); i++) {
      await Bun.sleep(25);
      await setup.renderOnce();
    }
    expect(setup.captureCharFrame()).toContain("Enable it for everyone immediately.");

    // annotate the risky paragraph, then submit request_changes
    const key = async (k: string) => {
      if (k === "enter") setup.mockInput.pressKey("RETURN");
      else await setup.mockInput.typeText(k);
      await Bun.sleep(15);
      await setup.renderOnce();
    };
    for (let i = 0; i < 6; i++) await key("j"); // to the Phase 2 paragraph
    await key("c");
    await setup.mockInput.typeText("Stage the rollout: 5% then 50% then 100%.");
    await key("enter");
    // wait until the annotate round-trip lands in the rail before submitting
    for (let i = 0; i < 40 && !setup.captureCharFrame().includes("REVIEW (1)"); i++) {
      await Bun.sleep(25);
      await setup.renderOnce();
    }
    expect(setup.captureCharFrame()).toContain("REVIEW (1)");
    await key("enter"); // open submit (request_changes default with pending item)
    expect(setup.captureCharFrame()).toContain("[Request changes]");
    await setup.mockInput.typeText("Too aggressive.");
    await key("enter");

    const out = await hook.result;
    expect(out.decision).toBe("deny");
    expect(out.reason).toContain("# Review: request changes");
    expect(out.reason).toContain("Too aggressive.");
    expect(out.reason).toContain("Stage the rollout: 5% then 50% then 100%.");
    expect(out.reason).toContain("> Enable it for everyone immediately.");
  }, 30_000);

  test("revision path: resubmit becomes revision 2 of the same session; approve allows", async () => {
    const revised = PLAN.replace("Enable it for everyone immediately.", "Enable it at 5%, then 50%, then 100%.");
    const hook = spawnHook(revised, 30_000);

    // wait for the revision to land (same session reopens as pending)
    const client = await DaemonClient.connect({ home });
    let sessionId = "";
    for (let i = 0; i < 100; i++) {
      const pending = await client.sessionList({ status: "pending" });
      if (pending.length) {
        sessionId = pending[0]!.id;
        break;
      }
      await Bun.sleep(50);
    }
    const session = await client.sessionGet(sessionId);
    expect(session.revisions.length).toBe(2);
    expect(session.artifact.content).toContain("at 5%, then 50%");

    await client.sessionResolve(sessionId, "approve", "Staged rollout looks right.");
    client.close();

    const out = await hook.result;
    expect(out.decision).toBe("allow");
    expect(out.reason).toContain("# Review: approve");
  }, 30_000);

  test("timeout path: the verdict outlives the hook window", async () => {
    const hook = spawnHook("# Late Plan\n\nSomething slow.\n", 300);
    const out = await hook.result;
    expect(out.decision).toBe("deny");
    expect(out.reason).toContain("still pending");

    // reviewer resolves after the hook gave up; the verdict is collectable
    const client = await DaemonClient.connect({ home });
    const pending = await client.sessionList({ status: "pending" });
    const late = pending.find((s) => s.artifact.content.includes("Late Plan"))!;
    await client.sessionResolve(late.id, "approve", "");
    const collected = await client.sessionWait(late.id, 1000);
    expect(collected!.verdict!.kind).toBe("approve");
    client.close();
  }, 30_000);
});
