/**
 * Local daemon control for the CLI: `cueloop stop` and `cueloop restart`, plus
 * the `stopDaemon` primitive `cueloop update` calls so a newer binary's next
 * launch autostarts a fresh daemon instead of talking to the stale-version one.
 */

import { existsSync, readFileSync } from "node:fs";
import { DaemonClient } from "@cueloop/daemon/client";
import { cueloopHome, pidPath, socketPath } from "@cueloop/daemon/paths";

/** Signal the daemon that owns `home` through its pid file; true when a signal was delivered. */
function signalDaemonByPid(home: string): boolean {
  const path = pidPath(home);

  if (!existsSync(path)) return false;
  const pid = Number(readFileSync(path, "utf8").trim());

  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid);

    return true;
  } catch {
    return false;
  }
}

/** Wait, briefly, for the stopped daemon to release its socket, so a restart binds cleanly. */
async function waitForSocketGone(home: string): Promise<void> {
  const path = socketPath(home);
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline && existsSync(path)) await Bun.sleep(50);
}

/**
 * Stop the daemon that owns `home`. Prefers the owner-gated shutdown request; a
 * version-mismatched or unreachable daemon (which refuses the handshake) is
 * signalled by pid instead. Returns whether a daemon was there to stop.
 */
export async function stopDaemon(home = cueloopHome()): Promise<boolean> {
  let stopped = false;

  if (existsSync(socketPath(home))) {
    try {
      const client = await DaemonClient.connect({ home, autostart: false });

      await client.shutdown();
      client.close();
      stopped = true;
    } catch {
      stopped = signalDaemonByPid(home);
    }
  } else {
    stopped = signalDaemonByPid(home);
  }
  if (stopped) await waitForSocketGone(home);

  return stopped;
}

/** `cueloop stop` - stop the local daemon. */
export async function stopCommand(): Promise<number> {
  const stopped = await stopDaemon();

  console.log(stopped ? "cueloop daemon stopped" : "no cueloop daemon is running");

  return 0;
}

/** `cueloop restart` - stop the local daemon, then autostart a fresh one. */
export async function restartCommand(): Promise<number> {
  await stopDaemon();
  const client = await DaemonClient.connect({ autostart: true });

  client.close();
  console.log("cueloop daemon restarted");

  return 0;
}
