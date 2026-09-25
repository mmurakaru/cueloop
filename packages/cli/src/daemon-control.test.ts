/**
 * `cueloop stop`'s primitive against a real detached daemon: stopping it clears
 * the socket and pid so the next launch autostarts a fresh one (the self-heal
 * `cueloop update` relies on), and stopping when none runs is a no-op.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { pidPath, socketPath } from "@cueloop/daemon/paths";
import { restartCommand, stopDaemon } from "./daemon-control";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-stop-"));
});
afterEach(async () => {
  await stopDaemon(home).catch(() => undefined);
  rmSync(home, { recursive: true, force: true });
});

test("stopDaemon stops a running daemon and clears its socket and pid", async () => {
  // Arrange - a real detached daemon owns the home
  const client = await DaemonClient.connect({ home, autostart: true });

  client.close();
  expect(existsSync(socketPath(home))).toBe(true);

  // Act
  const stopped = await stopDaemon(home);

  // Assert - it reported a stop, and the daemon released its socket and pid
  expect(stopped).toBe(true);
  expect(existsSync(socketPath(home))).toBe(false);
  expect(existsSync(pidPath(home))).toBe(false);
}, 60_000);

test("stopDaemon reports nothing to stop when no daemon is running", async () => {
  expect(await stopDaemon(home)).toBe(false);
});

test("restartCommand replaces the daemon and reconnects", async () => {
  const previousHome = process.env.CUELOOP_HOME;
  const first = await DaemonClient.connect({ home, autostart: true });
  const firstPid = (await first.ping()).pid;

  first.close();
  process.env.CUELOOP_HOME = home;

  try {
    expect(await restartCommand()).toBe(0);

    const restarted = await DaemonClient.connect({ home, autostart: false });

    try {
      expect((await restarted.ping()).pid).not.toBe(firstPid);
      expect(existsSync(socketPath(home))).toBe(true);
    } finally {
      restarted.close();
    }
  } finally {
    if (previousHome === undefined) delete process.env.CUELOOP_HOME;
    else process.env.CUELOOP_HOME = previousHome;
  }
}, 60_000);
