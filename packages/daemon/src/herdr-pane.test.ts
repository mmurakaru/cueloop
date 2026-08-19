/** Creation-side herdr pane opener: a stubbed herdr binary logs its argv, and the gating wrapper is checked for its three outcomes (no-op outside herdr, no-op on revision, full open for a new session). */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewSession } from "@cueloop/schema";
import { openHerdrPane, openHerdrPaneForReview } from "./herdr-pane";

const dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-pane-"));

/**
 * A stub herdr binary. It appends its argv to logPath and, when the verb is
 * `tab create`, prints a JSON result carrying the pane id on stdout so the
 * helper can drive send-text and send-keys. The printed shape mirrors the
 * REAL herdr `tab create` output ({ result: { root_pane: { pane_id } } },
 * verified against herdr 0.8.0) - an earlier stub invented a different shape
 * and let a parser that never matched real herdr pass the suite.
 */
function makeStub(name: string, paneId = "w1:p2"): { binPath: string; logPath: string } {
  const logPath = join(dir, `${name}.log`);
  const binPath = join(dir, `${name}.sh`);
  writeFileSync(
    binPath,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nif [ "$1" = "tab" ] && [ "$2" = "create" ]; then\n  printf '{"result":{"root_pane":{"pane_id":"${paneId}"}}}'\nfi\n`,
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
    // Arrange
    const stub = makeStub("open");

    // Act
    const ok = openHerdrPane({
      sessionId: "ses_abc",
      cwd: "/repo/work",
      binPath: stub.binPath,
      label: "Rollout Plan",
    });

    // Assert
    expect(ok).toBeTrue();
    expect(readLines(stub.logPath)).toEqual([
      "tab create --cwd /repo/work --label Rollout Plan --focus",
      "pane send-text w1:p2 cueloop ses_abc",
      "pane send-keys w1:p2 enter",
    ]);
  });

  test("returns false and never throws on a broken binary", () => {
    // Act
    const ok = openHerdrPane({
      sessionId: "ses_abc",
      cwd: "/repo/work",
      binPath: join(dir, "missing-bin"),
      label: "x",
    });

    // Assert
    expect(ok).toBeFalse();
  });

  test("bails out when tab create yields no pane id - no send-text, no send-keys", () => {
    // Arrange
    const logPath = join(dir, "nopane.log");
    const binPath = join(dir, "nopane.sh");
    writeFileSync(
      binPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nprintf '{"result":{}}'\n`,
    );
    chmodSync(binPath, 0o755);

    // Act
    const ok = openHerdrPane({ sessionId: "ses_abc", cwd: "/repo/work", binPath, label: "x" });

    // Assert
    expect(ok).toBeFalse();
    expect(readLines(logPath)).toEqual(["tab create --cwd /repo/work --label x --focus"]);
  });
});

describe("openHerdrPaneForReview", () => {
  test("opens a pane for a genuinely new session inside herdr", () => {
    // Arrange
    const stub = makeStub("gated-new");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };

    // Act
    openHerdrPaneForReview(newSession({ id: "ses_xyz" }), env);

    // Assert
    expect(readLines(stub.logPath)).toEqual([
      "tab create --cwd /repo/work --label Rollout Plan --focus",
      "pane send-text w1:p2 cueloop ses_xyz",
      "pane send-keys w1:p2 enter",
    ]);
  });

  test("no-op outside herdr - no herdr process is spawned", () => {
    // Arrange
    const stub = makeStub("gated-outside");

    // Act
    openHerdrPaneForReview(newSession(), { HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath });

    // Assert
    expect(existsSync(stub.logPath)).toBeFalse();
  });

  test("no-op for a revision - the already open pane is reused, not spammed", () => {
    // Arrange
    const stub = makeStub("gated-revision");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const revised = newSession({
      revisions: [
        { revision: 1, content: "# P", submittedAt: "now" },
        { revision: 2, content: "# P2", submittedAt: "now" },
      ],
    });

    // Act
    openHerdrPaneForReview(revised, env);

    // Assert
    expect(existsSync(stub.logPath)).toBeFalse();
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
