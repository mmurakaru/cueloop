/** Creation-side herdr pane opener: a stubbed herdr binary logs its argv, openHerdrPane returns the tab handle, and openHerdrPaneForReview opens+records for a new review, focuses a still-alive recorded tab, and reopens a dead one - collision-free by pane id. */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewSession } from "@cueloop/schema";
import { openHerdrPane, openHerdrPaneForReview } from "./herdr-pane";
import type { HerdrTabPersistence } from "./herdr-pane";
import type { HerdrTabHandle } from "./herdr-tab-store";

const dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-pane-"));

/**
 * A stub herdr binary. It logs argv, prints the tab-create result carrying both
 * pane_id and tab_id (herdr 0.8.2 shape), and answers `pane get` alive or dead
 * per `paneAlive` so the liveness branch can be exercised.
 */
function makeStub(name: string, paneAlive = false): { binPath: string; logPath: string } {
  const logPath = join(dir, `${name}.log`);
  const binPath = join(dir, `${name}.sh`);
  const paneGet = paneAlive ? `printf '{"result":{"pane":{"pane_id":"w1:p2"}}}'` : "exit 1";
  writeFileSync(
    binPath,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${logPath}"
if [ "$1" = "tab" ] && [ "$2" = "create" ]; then
  printf '{"result":{"root_pane":{"pane_id":"w1:p2","tab_id":"w1:t2"}}}'
fi
if [ "$1" = "pane" ] && [ "$2" = "get" ]; then ${paneGet}; fi
exit 0
`,
  );
  chmodSync(binPath, 0o755);
  return { binPath, logPath };
}

function readLines(logPath: string): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

/** In-memory persistence double: records what openHerdrPaneForReview saves. */
function fakePersistence(initial: HerdrTabHandle | null = null): {
  persistence: HerdrTabPersistence;
  saved: () => HerdrTabHandle | null;
} {
  let stored = initial;
  return {
    persistence: {
      herdrGetTab: async () => stored,
      herdrSetTab: async (_sessionId, handle) => {
        stored = handle;
      },
    },
    saved: () => stored,
  };
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
  test("creates a focused tab, launches the review, and returns the handle", () => {
    // Arrange
    const stub = makeStub("open");

    // Act
    const handle = openHerdrPane({
      sessionId: "ses_abc",
      cwd: "/repo/work",
      binPath: stub.binPath,
      label: "Rollout Plan",
    });

    // Assert
    expect(handle).toEqual({ tabId: "w1:t2", paneId: "w1:p2" });
    expect(readLines(stub.logPath)).toEqual([
      "tab create --cwd /repo/work --label Rollout Plan --focus",
      "pane send-text w1:p2 cueloop ses_abc",
      "pane send-keys w1:p2 enter",
    ]);
  });

  test("returns null and never throws on a broken binary", () => {
    expect(
      openHerdrPane({
        sessionId: "ses_abc",
        cwd: "/repo/work",
        binPath: join(dir, "missing-bin"),
        label: "x",
      }),
    ).toBeNull();
  });

  test("returns null when tab create yields no ids - no send-text, no send-keys", () => {
    // Arrange
    const logPath = join(dir, "nopane.log");
    const binPath = join(dir, "nopane.sh");
    writeFileSync(
      binPath,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nprintf '{"result":{}}'\n`,
    );
    chmodSync(binPath, 0o755);

    // Act
    const handle = openHerdrPane({ sessionId: "ses_abc", cwd: "/repo/work", binPath, label: "x" });

    // Assert
    expect(handle).toBeNull();
    expect(readLines(logPath)).toEqual(["tab create --cwd /repo/work --label x --focus"]);
  });
});

describe("openHerdrPaneForReview", () => {
  test("opens and records a tab for a review with no recorded tab", async () => {
    // Arrange
    const stub = makeStub("gated-new");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const store = fakePersistence(null);

    // Act
    await openHerdrPaneForReview(newSession({ id: "ses_xyz" }), store.persistence, env);

    // Assert
    expect(readLines(stub.logPath)).toEqual([
      "tab create --cwd /repo/work --label Rollout Plan --focus",
      "pane send-text w1:p2 cueloop ses_xyz",
      "pane send-keys w1:p2 enter",
    ]);
    expect(store.saved()).toEqual({ tabId: "w1:t2", paneId: "w1:p2" });
  });

  test("no-op outside herdr - no herdr process is spawned", async () => {
    // Arrange
    const stub = makeStub("gated-outside");
    const store = fakePersistence(null);

    // Act
    await openHerdrPaneForReview(newSession(), store.persistence, {
      HERDR_PANE_ID: "w1:p1",
      HERDR_BIN_PATH: stub.binPath,
    });

    // Assert
    expect(existsSync(stub.logPath)).toBeFalse();
    expect(store.saved()).toBeNull();
  });

  test("focuses the recorded tab when its pane is still alive, without reopening", async () => {
    // Arrange
    const stub = makeStub("gated-alive", true);
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const store = fakePersistence({ tabId: "w9:t9", paneId: "w9:p9" });

    // Act
    await openHerdrPaneForReview(newSession(), store.persistence, env);

    // Assert
    const lines = readLines(stub.logPath);
    expect(lines).toContain("pane get w9:p9");
    expect(lines).toContain("tab focus w9:t9");
    expect(lines.some((line) => line.startsWith("tab create"))).toBeFalse();
    expect(store.saved()).toEqual({ tabId: "w9:t9", paneId: "w9:p9" });
  });

  test("a persistence failure never escapes - review creation stays best-effort", async () => {
    // Arrange - the daemon store rejects; the opener must still resolve quietly
    const stub = makeStub("gated-persist-fail");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const persistence: HerdrTabPersistence = {
      herdrGetTab: async () => null,
      herdrSetTab: async () => {
        throw new Error("disk full");
      },
    };

    // Act & Assert - no throw
    await openHerdrPaneForReview(newSession(), persistence, env);
    expect(readLines(stub.logPath).some((line) => line.startsWith("tab create"))).toBeTrue();
  });

  test("a recall failure (stale daemon) still opens a fresh tab", async () => {
    // Arrange - a daemon predating the herdr-tab verbs rejects the recall
    const stub = makeStub("gated-recall-fail");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const persistence: HerdrTabPersistence = {
      herdrGetTab: async () => {
        throw new Error("unknown method herdr.getTab");
      },
      herdrSetTab: async () => {},
    };

    // Act
    await openHerdrPaneForReview(newSession({ id: "ses_stale" }), persistence, env);

    // Assert - the recall throwing must not abort the open
    expect(readLines(stub.logPath)).toEqual([
      "tab create --cwd /repo/work --label Rollout Plan --focus",
      "pane send-text w1:p2 cueloop ses_stale",
      "pane send-keys w1:p2 enter",
    ]);
  });

  test("reopens and re-records when the recorded pane is dead", async () => {
    // Arrange
    const stub = makeStub("gated-dead", false);
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const store = fakePersistence({ tabId: "old:t", paneId: "old:p" });

    // Act
    await openHerdrPaneForReview(newSession({ id: "ses_re" }), store.persistence, env);

    // Assert
    const lines = readLines(stub.logPath);
    expect(lines).toContain("pane get old:p");
    expect(lines).toContain("tab create --cwd /repo/work --label Rollout Plan --focus");
    expect(store.saved()).toEqual({ tabId: "w1:t2", paneId: "w1:p2" });
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
