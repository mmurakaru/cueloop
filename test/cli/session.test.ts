/**
 * Black-box CLI contract tests (tier 3): the real entrypoint spawned as a
 * subprocess against an isolated CUELOOP_HOME, including daemon autostart
 * and the cross-process wait/resolve round-trip.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import type { ReviewSession } from "@cueloop/schema";
import { cliJson, runCli } from "../helpers/cli";

const PLAN = "# Plan\n\n## Steps\n\nDo the migration in two phases.\n";

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-cli-"));
});
afterAll(async () => {
  try {
    const client = await DaemonClient.connect({ home });
    await client.shutdown();
    client.close();
  } catch {
    // daemon already gone
  }
  rmSync(home, { recursive: true, force: true });
});

describe("cueloop session (black box)", () => {
  let sessionId: string;

  test("create autostarts the daemon and prints the session", async () => {
    const r = await runCli(home, ["session", "create", "--type", "plan", "--title", "Migration", "--agent", "test"], PLAN);
    expect(r.code).toBe(0);
    const session = cliJson<ReviewSession>(r);
    expect(session.id.startsWith("ses_")).toBe(true);
    expect(session.artifact.content).toBe(PLAN);
    expect(session.status).toBe("pending");
    sessionId = session.id;
  });

  test("list and get see the session from a fresh process", async () => {
    const list = cliJson<ReviewSession[]>(await runCli(home, ["session", "list", "--status", "pending"]));
    expect(list.some((s) => s.id === sessionId)).toBe(true);
    const got = cliJson<ReviewSession>(await runCli(home, ["session", "get", sessionId]));
    expect(got.artifact.meta.title).toBe("Migration");
  });

  test("wait times out to pending without losing the session", async () => {
    const r = await runCli(home, ["session", "wait", sessionId, "--timeout-ms", "100"]);
    expect(cliJson<{ status: string }>(r)).toEqual({ status: "pending" });
  });

  test("annotate + resolve from separate processes; wait collects the verdict", async () => {
    const a = await runCli(home, [
      "session",
      "annotate",
      sessionId,
      "--quote",
      "two phases",
      "--prefix",
      "migration in ",
      "--suffix",
      ".",
      "--body",
      "Name the phases.",
    ]);
    expect(a.code).toBe(0);
    const res = await runCli(home, ["session", "resolve", sessionId, "--verdict", "request_changes", "--summary", "Phase names please."]);
    expect(res.code).toBe(0);
    const w = cliJson<{ status: string; allow: boolean; feedback: string }>(
      await runCli(home, ["session", "wait", sessionId, "--timeout-ms", "1000"]),
    );
    expect(w.status).toBe("resolved");
    expect(w.allow).toBe(false);
    expect(w.feedback).toContain("Name the phases.");
    expect(w.feedback).toContain("> two phases");
  });

  test("revision reopens through the CLI", async () => {
    const r = cliJson<ReviewSession>(
      await runCli(home, ["session", "submit-revision", sessionId], PLAN + "\n## Phase names\n\nAlpha, beta.\n"),
    );
    expect(r.status).toBe("pending");
    expect(r.revisions.length).toBe(2);
  });

  test("help output and unknown verbs", async () => {
    const help = await runCli(home, ["help"]);
    expect(help.stdout).toContain("cueloop session <verb>");
    const bad = await runCli(home, ["session", "frobnicate"]);
    expect(bad.code).toBe(2);
  });
});
