/** Herdr Thread launching with a stub CLI, including tab and pane reuse. */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Thread } from "@cueloop/schema";
import {
  openHerdrThreadTab,
  openHerdrThreadPane,
  openHerdrThreadSurface,
} from "./herdr-thread-surface";
import type { HerdrThreadSurfacePersistence } from "./herdr-thread-surface";
import type { HerdrThreadSurfaceHandle } from "./herdr-thread-surface-store";

const dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-thread-surface-"));

/**
 * A stub herdr binary. It logs argv, prints the tab-create result carrying both
 * pane_id and tab_id (herdr 0.8.2 shape), and answers `pane get` alive or dead
 * per `paneAlive` so the liveness branch can be exercised.
 */
function makeStub(name: string, paneAlive = false, neighborPaneId = "w1:p3") {
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
if [ "$1" = "pane" ] && [ "$2" = "split" ]; then
  printf '{"result":{"pane":{"pane_id":"w1:p3"}}}'
fi
if [ "$1" = "pane" ] && [ "$2" = "neighbor" ]; then
  printf '{"result":{"neighbor":{"neighbor_pane_id":"${neighborPaneId}"}}}'
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

/** In-memory persistence double for native Thread handles. */
function fakePersistence(initial: HerdrThreadSurfaceHandle | null = null) {
  let stored = initial;

  return {
    persistence: {
      herdrGetThreadSurface: async () => stored,
      herdrSetThreadSurface: async (_sessionId: string, handle: HerdrThreadSurfaceHandle) => {
        stored = handle;
      },
    },
    saved: () => stored,
  };
}

function newSession(overrides: Partial<Thread> = {}): Thread {
  return {
    schemaVersion: "1",
    id: "ses_new1",
    workspace: { repoRoot: "/repo", branch: "main" },
    artifact: { type: "plan", content: "# P", meta: { cwd: "/repo/work", title: "Rollout Plan" } },
    revisions: [{ revision: 1, content: "# P", submittedAt: "now" }],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "now",
    ...overrides,
  };
}

describe("openHerdrThreadTab", () => {
  test("creates a focused tab, launches the review, and returns the handle", () => {
    // Arrange
    const stub = makeStub("open");

    // Act
    const handle = openHerdrThreadTab({
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
      openHerdrThreadTab({
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
    const handle = openHerdrThreadTab({
      sessionId: "ses_abc",
      cwd: "/repo/work",
      binPath,
      label: "x",
    });

    // Assert
    expect(handle).toBeNull();
    expect(readLines(logPath)).toEqual(["tab create --cwd /repo/work --label x --focus"]);
  });
});

describe("openHerdrThreadPane", () => {
  test("creates a focused right-hand pane at 50 percent and launches cueloop", () => {
    const stub = makeStub("split");
    const handle = openHerdrThreadPane({
      sessionId: "ses_abc",
      cwd: "/repo/work",
      binPath: stub.binPath,
      sourcePaneId: "w1:p1",
      tabId: "w1:t1",
    });

    expect(handle).toEqual({
      mode: "pane",
      tabId: "w1:t1",
      paneId: "w1:p3",
      sourcePaneId: "w1:p1",
    });
    expect(readLines(stub.logPath)).toEqual([
      "pane split w1:p1 --direction right --ratio 0.5 --cwd /repo/work --focus",
      "pane send-text w1:p3 cueloop ses_abc",
      "pane send-keys w1:p3 enter",
    ]);
  });
});

describe("openHerdrThreadSurface", () => {
  test("tab mode targets the calling Herdr workspace", async () => {
    const stub = makeStub("workspace");
    const store = fakePersistence();
    const env = {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_WORKSPACE_ID: "w1",
      HERDR_BIN_PATH: stub.binPath,
    };

    expect(await openHerdrThreadSurface(newSession(), store.persistence, env, "tab")).toBe(
      "opened",
    );
    expect(readLines(stub.logPath)[0]).toBe(
      "tab create --workspace w1 --cwd /repo/work --label Rollout Plan --focus",
    );
  });

  test("pane mode focuses a live remembered pane and reopens a closed one", async () => {
    const stub = makeStub("pane-reopen", false);
    const env = {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_TAB_ID: "w1:t1",
      HERDR_BIN_PATH: stub.binPath,
    };
    const store = fakePersistence({
      mode: "pane",
      tabId: "w1:t1",
      paneId: "w1:p9",
      sourcePaneId: "w1:p1",
    });

    expect(await openHerdrThreadSurface(newSession(), store.persistence, env, "pane")).toBe(
      "opened",
    );
    expect(readLines(stub.logPath)).toContain("pane get w1:p9");
    expect(store.saved()).toEqual({
      mode: "pane",
      tabId: "w1:t1",
      paneId: "w1:p3",
      sourcePaneId: "w1:p1",
    });

    const live = makeStub("pane-focus", true);
    const liveEnv = { ...env, HERDR_BIN_PATH: live.binPath };

    expect(await openHerdrThreadSurface(newSession(), store.persistence, liveEnv, "pane")).toBe(
      "focused",
    );
    expect(readLines(live.logPath)).toEqual([
      "pane get w1:p3",
      "pane neighbor --pane w1:p1 --direction right",
      "tab focus w1:t1",
      "pane focus --pane w1:p1 --direction right",
    ]);
  });

  test("a moved live pane fails without opening a duplicate or focusing the wrong pane", async () => {
    const stub = makeStub("pane-moved", true, "w1:p4");
    const store = fakePersistence({
      mode: "pane",
      tabId: "w1:t1",
      paneId: "w1:p3",
      sourcePaneId: "w1:p1",
    });
    const env = {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p1",
      HERDR_TAB_ID: "w1:t1",
      HERDR_BIN_PATH: stub.binPath,
    };

    expect(await openHerdrThreadSurface(newSession(), store.persistence, env, "pane")).toBe(
      "failed",
    );
    expect(readLines(stub.logPath)).toEqual([
      "pane get w1:p3",
      "pane neighbor --pane w1:p1 --direction right",
    ]);
  });

  test("none never launches, and a launch failure reports failure without resolving the Thread", async () => {
    const stub = makeStub("disabled");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const store = fakePersistence();

    expect(await openHerdrThreadSurface(newSession(), store.persistence, env, "none")).toBe(
      "disabled",
    );
    expect(readLines(stub.logPath)).toEqual([]);
    expect(
      await openHerdrThreadSurface(
        newSession(),
        store.persistence,
        { ...env, HERDR_BIN_PATH: join(dir, "missing-binary") },
        "tab",
      ),
    ).toBe("failed");
    expect(store.saved()).toBeNull();
  });
  test("opens and records a tab for a review with no recorded tab", async () => {
    // Arrange
    const stub = makeStub("gated-new");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const store = fakePersistence(null);

    // Act
    await openHerdrThreadSurface(newSession({ id: "ses_xyz" }), store.persistence, env);

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
    await openHerdrThreadSurface(newSession(), store.persistence, {
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
    await openHerdrThreadSurface(newSession(), store.persistence, env);

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
    const persistence: HerdrThreadSurfacePersistence = {
      herdrGetThreadSurface: async () => null,
      herdrSetThreadSurface: async () => {
        throw new Error("disk full");
      },
    };

    // Act & Assert - no throw
    await openHerdrThreadSurface(newSession(), persistence, env);
    expect(readLines(stub.logPath).some((line) => line.startsWith("tab create"))).toBeTrue();
  });

  test("a recall failure (stale daemon) still opens a fresh tab", async () => {
    // Arrange - a daemon predating the herdr-tab primitives rejects the recall
    const stub = makeStub("gated-recall-fail");
    const env = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1", HERDR_BIN_PATH: stub.binPath };
    const persistence: HerdrThreadSurfacePersistence = {
      herdrGetThreadSurface: async () => {
        throw new Error("unknown method herdr.getThreadSurface");
      },
      herdrSetThreadSurface: async () => {},
    };

    // Act
    await openHerdrThreadSurface(newSession({ id: "ses_stale" }), persistence, env);

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
    await openHerdrThreadSurface(newSession({ id: "ses_re" }), store.persistence, env);

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
