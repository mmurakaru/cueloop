/** herdr tier-1 tests: HERDR_BIN_PATH points at a stub that logs its argv (the env contract is the seam), and the hook flow drives runHook against an in-process DaemonServer. Outside herdr (HERDR_ENV unset) the contract is total silence. */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { runHook } from "./claude-code/hook";
import { reportLabel, reportState } from "./herdr";

let dir: string;
let home: string;
let server: DaemonServer;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-"));
  home = join(dir, "home");
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
});

afterAll(() => {
  server.stop();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A stub herdr binary that appends its argv (space-joined) to logPath and, for
 * `tab create`, prints the JSON pane id the auto-open helper reads so the full
 * open-and-launch sequence runs.
 */
function makeStub(name: string): { binPath: string; logPath: string } {
  const logPath = join(dir, `${name}.log`);
  const binPath = join(dir, `${name}.sh`);
  writeFileSync(
    binPath,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nif [ "$1" = "tab" ] && [ "$2" = "create" ]; then\n  printf '{"result":{"root_pane":{"pane_id":"w1:p2","tab_id":"w1:t2"}}}'\nfi\n`,
  );
  chmodSync(binPath, 0o755);
  return { binPath, logPath };
}

/** Wait for the fire-and-forget stub processes to land `count` lines. */
async function waitForLines(logPath: string, count: number): Promise<string[]> {
  for (let i = 0; i < 100; i++) {
    if (existsSync(logPath)) {
      const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
      if (lines.length >= count) return lines;
    }
    await Bun.sleep(25);
  }
  throw new Error(`stub log ${logPath} never reached ${count} lines`);
}

const ENV_KEYS = ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_BIN_PATH"] as const;
const saved = new Map<string, string | undefined>();

function setHookEnv(vars: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

describe("report helpers", () => {
  test("reportState and reportLabel call the herdr binary with the contract args", async () => {
    // Arrange
    const stub = makeStub("helpers");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "pane-9", HERDR_BIN_PATH: stub.binPath };

    // Act
    reportState("blocked", env);
    await waitForLines(stub.logPath, 1);
    reportLabel("plan ready for review: Demo", env);
    const lines = await waitForLines(stub.logPath, 2);

    // Assert
    expect(lines[0]).toBe("pane report-agent pane-9 --source custom:cueloop --state blocked");
    expect(lines[1]).toBe(
      "pane report-metadata pane-9 --source custom:cueloop --token summary=plan ready for review: Demo --ttl-ms 3600000",
    );
  });

  test("no-ops outside herdr and never throws on a broken binary", async () => {
    // Arrange
    const stub = makeStub("noop");

    // Act
    reportState("blocked", { HERDR_PANE_ID: "p", HERDR_BIN_PATH: stub.binPath });
    reportLabel("x", { HERDR_PANE_ID: "p", HERDR_BIN_PATH: stub.binPath });
    reportState("blocked", {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "p",
      HERDR_BIN_PATH: join(dir, "missing-bin"),
    });
    await Bun.sleep(150);

    // Assert
    expect(existsSync(stub.logPath)).toBeFalse();
  });
});

function hookEvent(sessionId: string, plan: string) {
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
  const client = await DaemonClient.connect({ home });
  try {
    for (let i = 0; i < 100; i++) {
      const pending = await client.sessionList({ status: "pending" });
      const match = pending.find((candidate) => candidate.artifact.content.includes(marker));
      if (match) {
        await client.sessionResolve(match.id, kind, summary);
        return;
      }
      await Bun.sleep(25);
    }
    throw new Error(`hook never created a session containing "${marker}"`);
  } finally {
    client.close();
  }
}

describe("hook flow inside herdr", () => {
  test("reports blocked on submit, then working when the approved plan is presented again", async () => {
    // Arrange
    const stub = makeStub("verdict");
    setHookEnv({ HERDR_ENV: "1", HERDR_PANE_ID: "pane-7", HERDR_BIN_PATH: stub.binPath });
    const event = hookEvent("herdr-hook-1", "# Rollout Plan\n\nShip it slowly.\n");
    const noWake = () => {};

    // Act - first pass: opens the review + tab, reports blocked, denies immediately
    const first = await runHook(event, { home, armWake: noWake });

    // Assert
    expect(first.allow).toBeFalse();
    expect(first.reason).toContain("opened for human review");
    const before = await waitForLines(stub.logPath, 5);
    const paneLines = before.filter(
      (line) => line.startsWith("tab ") || line.startsWith("pane send-"),
    );
    expect(paneLines[0]).toBe(`tab create --cwd ${home} --label Rollout Plan --focus`);
    expect(paneLines[1]).toMatch(/^pane send-text w1:p2 cueloop ses_[a-z0-9_]+$/i);
    expect(paneLines[2]).toBe("pane send-keys w1:p2 enter");
    const reportLines = before.filter((line) => line.startsWith("pane report-"));
    expect(reportLines.sort()).toEqual([
      "pane report-agent pane-7 --source custom:cueloop --state blocked",
      "pane report-metadata pane-7 --source custom:cueloop --token summary=plan ready for review: Rollout Plan --ttl-ms 3600000",
    ]);

    // Act - the reviewer approves, then the agent presents the same plan again
    await resolvePending("Rollout Plan", "approve", "Looks right.");
    const second = await runHook(event, { home, armWake: noWake });

    // Assert
    expect(second.allow).toBeTrue();
    expect(second.reason).toContain("Looks right.");
    const after = await waitForLines(stub.logPath, 7);
    const outcomeLines = after.filter(
      (line) => line.includes("--state working") || line.includes("summary=review done"),
    );
    expect(outcomeLines.sort()).toEqual([
      "pane report-agent pane-7 --source custom:cueloop --state working",
      "pane report-metadata pane-7 --source custom:cueloop --token summary=review done: approve --ttl-ms 3600000",
    ]);
  }, 15_000);

  test("opening denies immediately and leaves the pane blocked - never a working report", async () => {
    // Arrange
    const stub = makeStub("noblock");
    setHookEnv({ HERDR_ENV: "1", HERDR_PANE_ID: "pane-7", HERDR_BIN_PATH: stub.binPath });

    // Act
    const decision = await runHook(hookEvent("herdr-hook-2", "# Late Plan\n\nSlow.\n"), {
      home,
      armWake: () => {},
    });

    // Assert
    expect(decision.allow).toBeFalse();
    expect(decision.reason).toContain("opened for human review");
    await Bun.sleep(150); // give any stray report time to land
    // pane auto-open (3 lines) + blocked report + label = 5; never a working report
    const lines = await waitForLines(stub.logPath, 5);
    expect(
      lines.some((line) => line === `tab create --cwd ${home} --label Late Plan --focus`),
    ).toBeTrue();
    expect(lines.join("\n")).not.toContain("--state working");
    expect(lines.join("\n")).toContain("--state blocked");
  }, 15_000);
});

describe("hook flow outside herdr", () => {
  test("total silence: HERDR_ENV unset means no herdr process is spawned", async () => {
    // Arrange
    const stub = makeStub("silence");
    // HERDR_ENV deliberately absent; the bin path alone must not activate anything
    setHookEnv({ HERDR_PANE_ID: "pane-7", HERDR_BIN_PATH: stub.binPath });

    // Act
    const decision = await runHook(hookEvent("herdr-hook-3", "# Quiet Plan\n\nNo pane.\n"), {
      home,
      armWake: () => {},
    });

    // Assert
    expect(decision.allow).toBeFalse();
    await Bun.sleep(200); // window for any stray fire-and-forget spawn
    expect(existsSync(stub.logPath)).toBeFalse();
  }, 15_000);
});
