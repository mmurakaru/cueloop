/**
 * Version handshake: a client must never keep talking to a daemon from an
 * earlier build (the stale-daemon-after-upgrade bug). The ping carries the
 * daemon's version; a mismatch without autostart is a clear error, and a
 * matching version connects normally.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "./server";
import { DaemonClient, DaemonClientError, daemonSpawnCommand } from "./client";
import { DAEMON_VERSION } from "./version";
import type { Artifact, WorkspaceKey } from "@cueloop/schema";

const WS: WorkspaceKey = { repoRoot: "/repo", branch: "main" };
const PLAN: Artifact = { type: "plan", content: "# P\n\nBody.\n", meta: {} };

let home: string;
const servers: DaemonServer[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-version-"));
});
afterEach(() => {
  for (const runningServer of servers.splice(0)) runningServer.stop();
  rmSync(home, { recursive: true, force: true });
});

function server(version?: string): DaemonServer {
  const daemonServer = new DaemonServer({ home, idleExitMs: 0, version });

  servers.push(daemonServer);

  return daemonServer;
}

describe("daemon version handshake", () => {
  test("a stale daemon is rejected when there is nothing to replace it", async () => {
    // Arrange - a daemon posing as an earlier build
    server("0.0.0-stale").start();

    // Act + Assert - without autostart the client cannot restart it, so it says why
    await expect(DaemonClient.connect({ home, autostart: false })).rejects.toMatchObject({
      code: "version_mismatch",
    });
    await expect(DaemonClient.connect({ home, autostart: false })).rejects.toBeInstanceOf(
      DaemonClientError,
    );
  });

  test("a current daemon connects and serves normally", async () => {
    // Arrange - a daemon on this build
    server(DAEMON_VERSION).start();
    const client = await DaemonClient.connect({ home, autostart: false });

    // Act - a round-trip proves the connection is live, not replaced
    const created = await client.sessionCreate(WS, PLAN);
    const listed = await client.sessionList();

    // Assert
    expect(listed.map((session) => session.id)).toContain(created.id);
    client.close();
  });
});

describe("daemon spawn command", () => {
  const SOURCE_URL = "file:///repo/packages/daemon/src/client.ts";

  test("from source it bun-runs main.ts", () => {
    expect(daemonSpawnCommand("/bin/bun", SOURCE_URL, false)).toEqual([
      "/bin/bun",
      "run",
      "/repo/packages/daemon/src/main.ts",
    ]);
  });

  test("dev-watch reloads the daemon on source edits", () => {
    expect(daemonSpawnCommand("/bin/bun", SOURCE_URL, true)).toEqual([
      "/bin/bun",
      "--watch",
      "run",
      "/repo/packages/daemon/src/main.ts",
    ]);
  });

  test("a compiled binary re-execs its own daemon command, never --watch", () => {
    expect(
      daemonSpawnCommand("/usr/local/bin/cueloop", "file:///$bunfs/root/cueloop", true),
    ).toEqual(["/usr/local/bin/cueloop", "daemon", "--autostart"]);
  });
});
