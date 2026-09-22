/**
 * Single-instance guarantee: one daemon per home. Two daemons over one
 * state directory means divergent in-memory sessions and clients seeing
 * whichever half they connect to.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { DaemonServer } from "./server";
import { DaemonClient } from "./client";
import { lockPath, ownerTokenPath, socketPath } from "./paths";
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

  test("stopping a refused server leaves the lock owner's socket intact", async () => {
    const first = server();
    const path = first.start();
    const refused = server();

    expect(refused.start()).toBeNull();
    refused.stop();
    expect(existsSync(path!)).toBe(true);
    const client = await DaemonClient.connect({ home });

    try {
      expect((await client.ping()).pid).toBe(process.pid);
    } finally {
      client.close();
    }
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

  test("a daemon does not steal a lock while its owner writes the pid", async () => {
    const path = lockPath(home);
    const script = `
      import { openSync, writeFileSync } from "node:fs";
      const fd = openSync(${JSON.stringify(path)}, "wx");
      console.log("lock created");
      setTimeout(() => writeFileSync(fd, String(process.pid)), 100);
      setTimeout(() => {}, 2_000);
    `;
    const owner = Bun.spawn([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const firstOutput = await owner.stdout.getReader().read();

      expect(new TextDecoder().decode(firstOutput.value)).toContain("lock created");
      expect(server().start()).toBeNull();
      expect(existsSync(socketPath(home))).toBe(false);
    } finally {
      owner.kill();
      await owner.exited;
    }
  });

  test("an autostarted daemon reclaims a stale socket after taking the lock", async () => {
    writeFileSync(socketPath(home), "stale socket");
    const client = await DaemonClient.connect({ home, autostart: true });

    try {
      expect((await client.ping()).pid).toBeGreaterThan(0);
    } finally {
      await client.shutdown();
      client.close();
    }
  });

  test("autostart reports the daemon error when the child cannot start", async () => {
    mkdirSync(ownerTokenPath(home));
    const previousTimeout = process.env.CUELOOP_START_TIMEOUT_MS;

    // This checks error reporting, not startup speed; allow the child to start on a loaded runner.
    process.env.CUELOOP_START_TIMEOUT_MS = "5000";
    try {
      await expect(DaemonClient.connect({ home, autostart: true })).rejects.toThrow("EISDIR");
    } finally {
      if (previousTimeout === undefined) delete process.env.CUELOOP_START_TIMEOUT_MS;
      else process.env.CUELOOP_START_TIMEOUT_MS = previousTimeout;
    }
  }, 10_000);

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

  test("autostart joins a daemon that bound its socket after the first dial", async () => {
    const running = server();
    const path = running.start();
    const created = running.core.sessionCreate({ workspace: WS, artifact: PLAN });
    const client = new DaemonClient();
    const previousTimeout = process.env.CUELOOP_START_TIMEOUT_MS;

    client["home"] = home;
    process.env.CUELOOP_START_TIMEOUT_MS = "250";

    try {
      await client["attachFreshDaemon"](home, path!);

      expect((await client.sessionGet(created.id)).id).toBe(created.id);
      expect(existsSync(path!)).toBe(true);
    } finally {
      client.close();
      if (previousTimeout === undefined) delete process.env.CUELOOP_START_TIMEOUT_MS;
      else process.env.CUELOOP_START_TIMEOUT_MS = previousTimeout;
    }
  });

  test("autostart retries after a socket closes during the handshake", async () => {
    const path = socketPath(home);
    const replacement = server();
    const transient = createServer((socket) => {
      socket.destroy();
      transient.close(() => {
        rmSync(path, { force: true });
        rmSync(lockPath(home), { force: true });
        replacement.start();
      });
    });

    writeFileSync(lockPath(home), String(process.pid));
    await new Promise<void>((resolve) => transient.listen(path, resolve));
    const client = new DaemonClient();
    const previousTimeout = process.env.CUELOOP_START_TIMEOUT_MS;

    client["home"] = home;
    process.env.CUELOOP_START_TIMEOUT_MS = "1000";
    try {
      await client["attachFreshDaemon"](home, path);
      expect((await client.ping()).pid).toBe(process.pid);
    } finally {
      client.close();
      if (transient.listening) transient.close();
      if (previousTimeout === undefined) delete process.env.CUELOOP_START_TIMEOUT_MS;
      else process.env.CUELOOP_START_TIMEOUT_MS = previousTimeout;
    }
  });
});
