/**
 * herdr tier-1 tests. The herdr binary is stubbed by pointing
 * HERDR_BIN_PATH at a script that appends its argv to a log file - the
 * env contract itself is the test seam. The hook flow drives runHook
 * against an in-process DaemonServer in a temp CUELOOP_HOME and resolves
 * the review from the server side, asserting exactly which reports fire.
 * Outside herdr (HERDR_ENV unset) the contract is total silence.
 */

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

/** A stub herdr binary that appends its argv (space-joined) to logPath. */
function makeStub(name: string): { binPath: string; logPath: string } {
  const logPath = join(dir, `${name}.log`);
  const binPath = join(dir, `${name}.sh`);
  writeFileSync(binPath, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\n`);
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

const ENV_KEYS = ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_BIN_PATH", "CUELOOP_WAIT_MS"] as const;
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
    const stub = makeStub("helpers");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "pane-9", HERDR_BIN_PATH: stub.binPath };
    reportState("blocked", env);
    await waitForLines(stub.logPath, 1);
    reportLabel("plan ready for review: Demo", env);
    const lines = await waitForLines(stub.logPath, 2);
    expect(lines[0]).toBe("pane report-agent pane-9 --source custom:cueloop --state blocked");
    expect(lines[1]).toBe(
      "pane report-metadata pane-9 --source custom:cueloop --token summary=plan ready for review: Demo --ttl-ms 3600000",
    );
  });

  test("no-ops outside herdr and never throws on a broken binary", async () => {
    const stub = makeStub("noop");
    reportState("blocked", { HERDR_PANE_ID: "p", HERDR_BIN_PATH: stub.binPath });
    reportLabel("x", { HERDR_PANE_ID: "p", HERDR_BIN_PATH: stub.binPath });
    reportState("blocked", { HERDR_ENV: "1", HERDR_PANE_ID: "p", HERDR_BIN_PATH: join(dir, "missing-bin") });
    await Bun.sleep(150);
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

async function resolvePending(marker: string, kind: "approve" | "request_changes", summary: string): Promise<void> {
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
  test("reports blocked + label on submit, working + outcome label on verdict", async () => {
    const stub = makeStub("verdict");
    setHookEnv({ HERDR_ENV: "1", HERDR_PANE_ID: "pane-7", HERDR_BIN_PATH: stub.binPath, CUELOOP_WAIT_MS: "10000" });

    const run = runHook(hookEvent("herdr-hook-1", "# Rollout Plan\n\nShip it slowly.\n"), home);
    // the pane reports blocked + label before the verdict lands
    const before = await waitForLines(stub.logPath, 2);
    expect(before.sort()).toEqual([
      "pane report-agent pane-7 --source custom:cueloop --state blocked",
      "pane report-metadata pane-7 --source custom:cueloop --token summary=plan ready for review: Rollout Plan --ttl-ms 3600000",
    ]);

    await resolvePending("Rollout Plan", "approve", "Looks right.");
    const decision = await run;
    expect(decision.allow).toBeTrue();

    const after = await waitForLines(stub.logPath, 4);
    expect(after.slice(2).sort()).toEqual([
      "pane report-agent pane-7 --source custom:cueloop --state working",
      "pane report-metadata pane-7 --source custom:cueloop --token summary=review done: approve --ttl-ms 3600000",
    ]);
  }, 15_000);

  test("pending timeout leaves the pane blocked - no working report", async () => {
    const stub = makeStub("timeout");
    setHookEnv({ HERDR_ENV: "1", HERDR_PANE_ID: "pane-7", HERDR_BIN_PATH: stub.binPath, CUELOOP_WAIT_MS: "200" });

    const decision = await runHook(hookEvent("herdr-hook-2", "# Late Plan\n\nSlow.\n"), home);
    expect(decision.allow).toBeFalse();
    expect(decision.reason).toContain("still pending");

    await Bun.sleep(150); // give any stray report time to land
    const lines = await waitForLines(stub.logPath, 2);
    expect(lines.length).toBe(2);
    expect(lines.join("\n")).not.toContain("--state working");
    expect(lines.join("\n")).toContain("--state blocked");
  }, 15_000);
});

describe("hook flow outside herdr", () => {
  test("total silence: HERDR_ENV unset means no herdr process is spawned", async () => {
    const stub = makeStub("silence");
    // HERDR_ENV deliberately absent; the bin path alone must not activate anything
    setHookEnv({ HERDR_PANE_ID: "pane-7", HERDR_BIN_PATH: stub.binPath, CUELOOP_WAIT_MS: "10000" });

    const run = runHook(hookEvent("herdr-hook-3", "# Quiet Plan\n\nNo pane.\n"), home);
    await resolvePending("Quiet Plan", "request_changes", "Tighten it.");
    const decision = await run;
    expect(decision.allow).toBeFalse();

    await Bun.sleep(200); // window for any stray fire-and-forget spawn
    expect(existsSync(stub.logPath)).toBeFalse();
  }, 15_000);
});
