/**
 * Creation-side herdr pane opener tests. The herdr binary is stubbed by a
 * script that both records its argv to a log file and, for `tab create`,
 * prints the JSON the helper reads to learn the new pane id. The gating
 * wrapper is exercised for its three outcomes: no-op outside herdr, no-op for
 * a revision (the open pane is reused), and a full open for a genuinely new
 * session.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewSession } from "@cueloop/schema";
import { openHerdrPane, openHerdrPaneForReview } from "./herdr-pane";

const dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-pane-"));

/**
 * A stub herdr binary. It appends its argv to logPath and, when the verb is
 * `tab create`, prints a JSON result carrying paneId on stdout so the helper
 * can drive send-text and send-keys.
 */
function makeStub(name: string, paneId = "w1:p2"): { binPath: string; logPath: string } {
  const logPath = join(dir, `${name}.log`);
  const binPath = join(dir, `${name}.sh`);
  writeFileSync(
    binPath,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nif [ "$1" = "tab" ] && [ "$2" = "create" ]; then\n  printf '{"result":{"pane":{"id":"${paneId}"}}}'\nfi\n`,
  );
  chmodSync(binPath, 0o755);
  return { binPath, logPath };
}

function readLines(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

function newSession(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    schemaVersion: "1",
    id: "ses_new1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# P", meta: { cwd: "/repo/work", title: "Rollout Plan" } },
    revisions: [{ revision: 1, content: "# P", submittedAt: "now" }],
    annotations: [],
    verdict: null,
    status: "pending",
    createdAt: "now",
    ...overrides,
  };
}

describe("openHerdrPane", () => {
  test("creates a focused tab, types the cueloop command, and presses enter", () => {
    const stub = makeStub("open");
    const ok = openHerdrPane({ sessionId: "ses_abc", cwd: "/repo/work", binPath: stub.binPath, label: "Rollout Plan" });
    expect(ok).toBeTrue();
    expect(readLines(stub.logPath)).toEqual([
      "tab create --cwd /repo/work --label Rollout Plan --focus",
      "pane send-text w1:p2 cueloop ses_abc",
      "pane send-keys w1:p2 enter",
    ]);
  });

  test("returns false and never throws on a broken binary", () => {
    const ok = openHerdrPane({
      sessionId: "ses_abc",
      cwd: "/repo/work",
      binPath: join(dir, "missing-bin"),
      label: "x",
    });
    expect(ok).toBeFalse();
  });

  test("bails out when tab create yields no pane id - no send-text, no send-keys", () => {
    const logPath = join(dir, "nopane.log");
    const binPath = join(dir, "nopane.sh");
    writeFileSync(binPath, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nprintf '{"result":{}}'\n`);
    chmodSync(binPath, 0o755);
    const ok = openHerdrPane({ sessionId: "ses_abc", cwd: "/repo/work", binPath, label: "x" });
    expect(ok).toBeFalse();
    expect(readLines(logPath)).toEqual(["tab create --cwd /repo/work --label x --focus"]);
  });
});

describe("openHerdrPaneForReview", () => {
  test("opens a pane for a genuinely new session inside herdr", () => {
    const stub = makeStub("gated-new");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    openHerdrPaneForReview(newSession({ id: "ses_xyz" }), env);
    expect(readLines(stub.logPath)).toEqual([
      "tab create --cwd /repo/work --label Rollout Plan --focus",
      "pane send-text w1:p2 cueloop ses_xyz",
      "pane send-keys w1:p2 enter",
    ]);
  });

  test("no-op outside herdr - no herdr process is spawned", () => {
    const stub = makeStub("gated-outside");
    openHerdrPaneForReview(newSession(), { HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath });
    expect(existsSync(stub.logPath)).toBeFalse();
  });

  test("no-op for a revision - the already open pane is reused, not spammed", () => {
    const stub = makeStub("gated-revision");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const revised = newSession({
      revisions: [
        { revision: 1, content: "# P", submittedAt: "now" },
        { revision: 2, content: "# P2", submittedAt: "now" },
      ],
    });
    openHerdrPaneForReview(revised, env);
    expect(existsSync(stub.logPath)).toBeFalse();
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
