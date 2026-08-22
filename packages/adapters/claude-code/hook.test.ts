/** The non-blocking ExitPlanMode gate: opening a plan denies immediately and arms the wake; the same plan re-presented after approval is allowed through; a plan that came back with changes opens a fresh review round instead of an allow. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { runHook } from "./hook";

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cc-hook-"));
});
afterAll(async () => {
  try {
    const daemonClient = await DaemonClient.connect({ home });
    await daemonClient.shutdown();
    daemonClient.close();
  } catch {
    // daemon already gone
  }
  rmSync(home, { recursive: true, force: true });
});

function planEvent(sessionId: string, plan: string) {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    cwd: home,
    tool_name: "ExitPlanMode",
    tool_input: { plan },
  };
}

async function resolvePending(
  marker: string,
  kind: "approve" | "request_changes",
  summary: string,
): Promise<void> {
  const client = await DaemonClient.connect({ home, autostart: true });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const pending = await client.sessionList({ status: "pending" });
      const match = pending.find((candidate) => candidate.artifact.content.includes(marker));
      if (match) {
        await client.sessionResolve(match.id, kind, summary);
        return;
      }
      await Bun.sleep(25);
    }
    throw new Error(`no pending session for marker ${marker}`);
  } finally {
    client.close();
  }
}

describe("runHook: non-blocking plan gate", () => {
  test("no plan payload passes straight through without touching the daemon", async () => {
    // Act
    const decision = await runHook({ tool_input: {} }, { home, armWake: () => {} });

    // Assert
    expect(decision.allow).toBe(true);
    expect(decision.reason).toContain("no plan payload");
  });

  test("first pass opens the review, arms the wake, and denies without blocking", async () => {
    // Arrange
    const armed: string[] = [];
    const plan = "# Open Plan\n\nDo the thing.\n";

    // Act
    const decision = await runHook(planEvent("cc-open", plan), {
      home,
      armWake: (sessionId) => armed.push(sessionId),
    });

    // Assert
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("opened for human review");
    expect(armed.length).toBe(1);
    const client = await DaemonClient.connect({ home });
    const pending = await client.sessionList({ status: "pending" });
    client.close();
    expect(pending.some((session) => session.artifact.content === plan)).toBe(true);
  });

  test("the same plan, once approved, is allowed through and carries the feedback", async () => {
    // Arrange
    const plan = "# Approve Me\n\nShip it.\n";
    const event = planEvent("cc-approve", plan);

    // Act
    const first = await runHook(event, { home, armWake: () => {} });

    // Assert
    expect(first.allow).toBe(false);

    // Act - reviewer approves, agent presents the same plan again
    await resolvePending("Approve Me", "approve", "Green light.");
    const second = await runHook(event, { home, armWake: () => {} });

    // Assert
    expect(second.allow).toBe(true);
    expect(second.reason).toContain("Green light.");
  });

  test("a plan that came back with changes opens a fresh round, not an allow", async () => {
    // Arrange
    const event = planEvent("cc-changes", "# Changes Me\n\nFirst cut.\n");
    await runHook(event, { home, armWake: () => {} });
    await resolvePending("Changes Me", "request_changes", "Not yet.");
    const armed: string[] = [];

    // Act - agent revises and presents the new plan
    const revised = planEvent("cc-changes", "# Changes Me\n\nRevised cut.\n");
    const decision = await runHook(revised, {
      home,
      armWake: (sessionId) => armed.push(sessionId),
    });

    // Assert
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain("opened for human review");
    expect(armed.length).toBe(1);
  });
});
