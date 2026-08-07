/**
 * Single-instance guarantee (#14): one daemon per home. Two daemons over one
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
  for (const s of servers.splice(0)) s.stop();
  rmSync(home, { recursive: true, force: true });
});

function server(): DaemonServer {
  const s = new DaemonServer({ home, idleExitMs: 0 });
  servers.push(s);
  return s;
}

describe("one daemon per home", () => {
  test("the second start is refused instead of stealing the socket", () => {
    const first = server();
    const path = first.start();
    expect(path).toBe(socketPath(home));
    const second = server();
    expect(second.start()).toBeNull();
    // the winner's socket survives untouched
    expect(existsSync(path!)).toBe(true);
  });

  test("clients keep talking to the one live daemon after a refused start", async () => {
    const first = server();
    first.start();
    const created = first.core.sessionCreate({ workspace: WS, artifact: PLAN });
    server().start(); // refused
    const client = await DaemonClient.connect({ home });
    try {
      // no split brain: the session created on the winner is visible
      expect((await client.sessionGet(created.id)).id).toBe(created.id);
      expect((await client.sessionList()).length).toBe(1);
    } finally {
      client.close();
    }
  });

  test("a stale lock from a crashed daemon is reclaimed", () => {
    // a pid that cannot be running (init is never a cueloop daemon, and this
    // simulates the record a crashed process leaves behind)
    writeFileSync(lockPath(home), "999999");
    const s = server();
    expect(s.start()).toBe(socketPath(home));
  });

  test("stopping releases the lock so a restart works", () => {
    const first = server();
    first.start();
    first.stop();
    expect(existsSync(lockPath(home))).toBe(false);
    const second = server();
    expect(second.start()).toBe(socketPath(home));
  });

  test("concurrent autostarts converge on a single daemon", async () => {
    // several clients race to autostart; all must end up on the same daemon
    const clients = await Promise.all([
      DaemonClient.connect({ home, autostart: true }),
      DaemonClient.connect({ home, autostart: true }),
      DaemonClient.connect({ home, autostart: true }),
    ]);
    try {
      const pids = await Promise.all(clients.map((c) => c.ping()));
      const unique = new Set(pids.map((p) => p.pid));
      expect(unique.size).toBe(1);
      // and state is shared: one client's session is visible to the others
      const s = await clients[0]!.sessionCreate(WS, PLAN);
      expect((await clients[2]!.sessionGet(s.id)).id).toBe(s.id);
    } finally {
      for (const c of clients) c.close();
      // the autostarted daemon is not one of `servers` - shut it down
      const admin = await DaemonClient.connect({ home });
      await admin.shutdown();
      admin.close();
    }
  }, 60_000);
});
