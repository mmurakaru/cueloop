/**
 * Single-instance guarantee: one daemon per home. Two daemons over one
 * state directory means divergent in-memory sessions and clients seeing
 * whichever half they connect to.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "./server";
import { DaemonClient } from "./client";
import { lockPath, socketPath } from "./paths";
import type { Artifact, WorkspaceKey } from "@cueloop/schema";

const WS: WorkspaceKey = { repoRoot: "/repo", branch: "main" };
const PLAN: Artifact = { type: "plan", content: "# P\n\nBody.\n", meta: {} };

let home: string;
const servers: DaemonServer[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-lock-"));
});
afterEach(() => {
  for (const runningServer of servers.splice(0)) runningServer.stop();
  rmSync(home, { recursive: true, force: true });
});

function server(): DaemonServer {
  const daemonServer = new DaemonServer({ home, idleExitMs: 0 });
  servers.push(daemonServer);
  return daemonServer;
}

describe("one daemon per home", () => {
  test("the second start is refused instead of stealing the socket", () => {
    // Arrange
    const first = server();
    const path = first.start();
    expect(path).toBe(socketPath(home));
    const second = server();

    // Assert
    expect(second.start()).toBeNull();
    // the winner's socket survives untouched
    expect(existsSync(path!)).toBe(true);
  });

  test("clients keep talking to the one live daemon after a refused start", async () => {
    // Arrange
    const first = server();
    first.start();
    const created = first.core.sessionCreate({ workspace: WS, artifact: PLAN });
    server().start(); // refused
    const client = await DaemonClient.connect({ home });

    // Assert
    try {
      // no split brain: the session created on the winner is visible
      expect((await client.sessionGet(created.id)).id).toBe(created.id);
      expect((await client.sessionList()).length).toBe(1);
    } finally {
      client.close();
    }
  });

  test("a stale lock from a crashed daemon is reclaimed", () => {
    // Arrange
    // a pid that cannot be running (init is never a cueloop daemon, and this
    // simulates the record a crashed process leaves behind)
    writeFileSync(lockPath(home), "999999");
    const daemonServer = server();

    // Assert
    expect(daemonServer.start()).toBe(socketPath(home));
  });

  test("stopping releases the lock so a restart works", () => {
    // Arrange
    const first = server();
    first.start();

    // Act
    first.stop();

    // Assert
    expect(existsSync(lockPath(home))).toBe(false);
    const second = server();
    expect(second.start()).toBe(socketPath(home));
  });

  test("concurrent autostarts converge on a single daemon", async () => {
    // Act
    // several clients race to autostart; all must end up on the same daemon
    const clients = await Promise.all([
      DaemonClient.connect({ home, autostart: true }),
      DaemonClient.connect({ home, autostart: true }),
      DaemonClient.connect({ home, autostart: true }),
    ]);

    // Assert
    try {
      const pids = await Promise.all(clients.map((client) => client.ping()));
      const unique = new Set(pids.map((ping) => ping.pid));
      expect(unique.size).toBe(1);
      // and state is shared: one client's session is visible to the others
      const session = await clients[0]!.sessionCreate(WS, PLAN);
      expect((await clients[2]!.sessionGet(session.id)).id).toBe(session.id);
    } finally {
      for (const c of clients) c.close();
      // the autostarted daemon is not one of `servers` - shut it down
      const admin = await DaemonClient.connect({ home });
      await admin.shutdown();
      admin.close();
    }
  }, 60_000);
});
