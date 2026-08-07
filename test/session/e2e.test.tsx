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

/** Generous on purpose: these spawn real subprocesses on shared CI runners. */
const POLL_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;

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
  /** Diagnostics: a hook that dies early must not surface as a bare timeout. */
  stderr: Promise<string>;
  exited: Promise<number>;
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
  const stderr = new Response(proc.stderr).text();
  const exited = proc.exited;
  const result = (async () => {
    const out = await new Response(proc.stdout).text();
    if (!out.trim()) {
      throw new Error(`hook produced no output (exit ${await exited}); stderr:\n${await stderr}`);
    }
    const parsed = JSON.parse(out.trim()) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    return {
      decision: parsed.hookSpecificOutput.permissionDecision,
      reason: parsed.hookSpecificOutput.permissionDecisionReason,
    };
  })();
  return { proc, result, stderr, exited };
}

/**
 * Poll until the hook subprocess has created its session. Wall-clock deadline,
 * not an iteration count: a cold CI runner pays for a bun start plus a daemon
 * spawn before the first session appears, which a tight loop mistakes for a
 * failure.
 */
async function waitForPendingSession(
  hook?: HookRun,
  predicate?: (s: ReviewSession) => boolean,
): Promise<string> {
  const client = await DaemonClient.connect({ home, autostart: true });
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let hookDied: string | null = null;
  if (hook) {
    void hook.exited.then(async (code) => {
      if (code !== 0) hookDied = `hook exited ${code}; stderr:\n${await hook.stderr}`;
    });
  }
  try {
    while (Date.now() < deadline) {
      const pending = await client.sessionList({ status: "pending" });
      const match = predicate ? pending.find(predicate) : pending[0];
      if (match) return match.id;
      if (hookDied) throw new Error(hookDied);
      await Bun.sleep(50);
    }
    throw new Error(
      `no pending session appeared within ${POLL_TIMEOUT_MS}ms` +
        (hook ? `; hook stderr so far:\n${await Promise.race([hook.stderr, Promise.resolve("(still running)")])}` : ""),
    );
  } finally {
    client.close();
  }
}

describe("slice 1: Claude Code plan round-trip", () => {
  test("deny path: reviewer annotates and requests changes; hook relays feedback.md", async () => {
    const hook = spawnHook(PLAN, 30_000);
    const sessionId = await waitForPendingSession(hook);

    // the reviewer opens the session in the real TUI
    const setup = await testRender(<App home={home} sessionId={sessionId} />, { width: 120, height: 30 });
    const uiDeadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < uiDeadline && !setup.captureCharFrame().includes("Rollout Plan")) {
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
    const railDeadline = Date.now() + POLL_TIMEOUT_MS;
    while (railDeadline > Date.now() && !setup.captureCharFrame().includes("REVIEW (1)")) {
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
  }, TEST_TIMEOUT_MS);

  test("revision path: resubmit becomes revision 2 of the same session; approve allows", async () => {
    const revised = PLAN.replace("Enable it for everyone immediately.", "Enable it at 5%, then 50%, then 100%.");
    const hook = spawnHook(revised, 30_000);

    // wait for the revision to land (same session reopens as pending)
    const sessionId = await waitForPendingSession(hook, (s) => s.revisions.length >= 2);
    const client = await DaemonClient.connect({ home });
    const session = await client.sessionGet(sessionId);
    expect(session.revisions.length).toBe(2);
    expect(session.artifact.content).toContain("at 5%, then 50%");

    await client.sessionResolve(sessionId, "approve", "Staged rollout looks right.");
    client.close();

    const out = await hook.result;
    expect(out.decision).toBe("allow");
    expect(out.reason).toContain("# Review: approve");
  }, TEST_TIMEOUT_MS);

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
  }, TEST_TIMEOUT_MS);
});
