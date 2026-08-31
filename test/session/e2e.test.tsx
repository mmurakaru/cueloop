/**
 * The end-to-end review loop: agent → daemon → TUI → verdict → agent, with
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
import { press, typeText, waitForText } from "../../packages/client/src/test-support";
import { HERMETIC_HERDR_ENV } from "../helpers/env";

/** Generous on purpose: these spawn real subprocesses on shared CI runners. */
const POLL_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;
/**
 * The daemon-startup budget (DaemonClient's autostart deadline) is separate from
 * the per-test timeout above and defaults to 30s. On a contended CI runner a
 * cold bun start plus a daemon spawn can miss that window, failing inside
 * connect() long before the generous test budget - so raise it to match.
 */
const START_TIMEOUT_MS = 60_000;

const HOOK = join(import.meta.dir, "..", "..", "packages", "adapters", "claude-code", "hook.ts");

const PLAN = `# Rollout Plan

## Phase 1

Ship the daemon behind a flag.

## Phase 2

Enable it for everyone immediately.
`;

let home: string;
let priorStartTimeout: string | undefined;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-e2e-"));
  // Applies to this test's connect() and, via spawnHook's inherited env, the hook subprocess.
  priorStartTimeout = process.env.CUELOOP_START_TIMEOUT_MS;
  process.env.CUELOOP_START_TIMEOUT_MS = String(START_TIMEOUT_MS);
});
afterAll(async () => {
  try {
    const c = await DaemonClient.connect({ home });

    await c.shutdown();
    c.close();
  } catch {
    // daemon already gone
  }
  if (priorStartTimeout === undefined) delete process.env.CUELOOP_START_TIMEOUT_MS;
  else process.env.CUELOOP_START_TIMEOUT_MS = priorStartTimeout;
  rmSync(home, { recursive: true, force: true });
});

interface HookRun {
  proc: ReturnType<typeof Bun.spawn>;
  result: Promise<{ decision: string; reason: string }>;
  /** Diagnostics: a hook that dies early must not surface as a bare timeout. */
  stderr: Promise<string>;
  exited: Promise<number>;
}

interface SpawnHookOptions {
  sessionId?: string;
  /** When set, the detached wake posts here; otherwise the wake is a no-op. */
  inboxSocket?: string;
}

function spawnHook(plan: string, options: SpawnHookOptions = {}): HookRun {
  const event = {
    hook_event_name: "PreToolUse",
    session_id: options.sessionId ?? "cc-session-1",
    cwd: home,
    tool_name: "ExitPlanMode",
    tool_input: { plan },
  };
  const proc = Bun.spawn([process.execPath, "run", HOOK], {
    env: {
      ...process.env,
      ...HERMETIC_HERDR_ENV,
      CUELOOP_HOME: home,
      CUELOOP_IDLE_EXIT_MS: "0",
      // Explicit so a test running inside a real Claude Code session never leaks
      // its own inbox into the hook: empty is treated as no inbox.
      CLAUDE_CODE_MESSAGING_SOCKET: options.inboxSocket ?? "",
      CLAUDE_CODE_MESSAGING_TOKEN: options.inboxSocket ? "e2e-token" : "",
    },
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
    const parsed: {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    } = JSON.parse(out.trim());

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
  predicate?: (session: ReviewSession) => boolean,
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
        (hook
          ? `; hook stderr so far:\n${await Promise.race([hook.stderr, Promise.resolve("(still running)")])}`
          : ""),
    );
  } finally {
    client.close();
  }
}

/** A fake Claude Code inbox: capture the frames the detached wake posts, then resolve. */
function fakeInbox() {
  const inboxHome = mkdtempSync(join(tmpdir(), "cueloop-e2e-inbox-"));
  const socketPath = join(inboxHome, "s.sock");
  let received = "";
  const gotFrames = Promise.withResolvers<string>();
  const server = Bun.listen({
    unix: socketPath,
    socket: {
      data: (_socket, data) => {
        received += data.toString();
      },
      close: () => gotFrames.resolve(received),
      open: () => {},
    },
  });

  return {
    socketPath,
    frames: gotFrames.promise,
    stop: () => {
      server.stop();
      rmSync(inboxHome, { recursive: true, force: true });
    },
  };
}

describe("slice 1: Claude Code plan round-trip (non-blocking)", () => {
  test(
    "opening denies immediately; the reviewer's changes reach the session via the wake",
    async () => {
      // Arrange - the hook arms a real detached wake pointed at a fake inbox
      const inbox = fakeInbox();
      const hook = spawnHook(PLAN, { sessionId: "cc-deny", inboxSocket: inbox.socketPath });

      // Assert - the gate does not block: it opens the review and denies at once
      const out = await hook.result;

      expect(out.decision).toBe("deny");
      expect(out.reason).toContain("opened for human review");

      // Act - the reviewer opens the pending session in the real TUI
      const sessionId = await waitForPendingSession(
        undefined,
        (candidate) => candidate.artifact.meta.agentSessionId === "cc-deny",
      );
      const setup = await testRender(<App home={home} sessionId={sessionId} />, {
        width: 120,
        height: 30,
      });

      await waitForText(setup, "Rollout Plan");
      expect(setup.captureCharFrame()).toContain("Enable it for everyone immediately.");

      // Act - annotate the risky paragraph, then submit request_changes
      for (let i = 0; i < 6; i++) await press(setup, "j"); // to the Phase 2 paragraph
      await press(setup, "c");
      await typeText(setup, "Stage the rollout: 5% then 50% then 100%.");
      await press(setup, "enter");
      await waitForText(setup, "COMMENT · me");
      await press(setup, "enter"); // open submit (request_changes default with pending item)
      expect(setup.captureCharFrame()).toContain("[Changes]");
      await typeText(setup, "Too aggressive.");
      await press(setup, "enter");

      // Assert - the detached wake injects feedback.md into the inbox
      const frames = await inbox.frames;
      const content = JSON.parse(frames.trim().split("\n").at(-1)!).message.content;

      expect(content).toContain("# Review: request changes");
      expect(content).toContain("Too aggressive.");
      expect(content).toContain("Stage the rollout: 5% then 50% then 100%.");
      expect(content).toContain("> Enable it for everyone immediately.");
      inbox.stop();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "approve then re-present: the same plan is allowed through carrying the verdict",
    async () => {
      // Arrange - first pass opens the review and denies
      const first = await spawnHook(PLAN, { sessionId: "cc-approve" }).result;

      expect(first.decision).toBe("deny");
      const sessionId = await waitForPendingSession(
        undefined,
        (candidate) => candidate.artifact.meta.agentSessionId === "cc-approve",
      );

      // Act - reviewer approves, then the agent presents the same plan again
      const client = await DaemonClient.connect({ home });

      await client.sessionResolve(sessionId, "approve", "Staged rollout looks right.");
      client.close();
      const second = await spawnHook(PLAN, { sessionId: "cc-approve" }).result;

      // Assert
      expect(second.decision).toBe("allow");
      expect(second.reason).toContain("# Review: approve");
      expect(second.reason).toContain("Staged rollout looks right.");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a revised plan after changes opens a fresh review round, not an allow",
    async () => {
      // Arrange - open, then the reviewer requests changes
      await spawnHook(PLAN, { sessionId: "cc-revise" }).result;
      const sessionId = await waitForPendingSession(
        undefined,
        (candidate) => candidate.artifact.meta.agentSessionId === "cc-revise",
      );
      const client = await DaemonClient.connect({ home });

      await client.sessionResolve(sessionId, "request_changes", "Too aggressive.");

      // Act - the agent revises and presents the new plan
      const revised = PLAN.replace(
        "Enable it for everyone immediately.",
        "Enable it at 5%, then 50%, then 100%.",
      );
      const out = await spawnHook(revised, { sessionId: "cc-revise" }).result;

      // Assert - denied again (new round), and the session is revision 2 pending
      expect(out.decision).toBe("deny");
      expect(out.reason).toContain("opened for human review");
      const session = await client.sessionGet(sessionId);

      client.close();
      expect(session.revisions.length).toBe(2);
      expect(session.artifact.content).toContain("at 5%, then 50%");
      expect(session.status).toBe("pending");
    },
    TEST_TIMEOUT_MS,
  );
});
