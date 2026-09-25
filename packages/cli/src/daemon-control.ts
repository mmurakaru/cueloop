/**
 * Local daemon control: `cueloop stop` and `cueloop restart`, and the
 * `stopDaemon` primitive `cueloop update` calls so a newer binary is not left
 * talking to the old-version daemon (which refuses the handshake).
 */

import { existsSync, readFileSync } from "node:fs";
import * as v from "valibot";
import { DaemonClient } from "@cueloop/daemon/client";
import { cueloopHome, pidPath, socketPath } from "@cueloop/daemon/paths";

const ProcessIdSchema = v.pipe(
  v.string(),
  v.transform((raw) => Number(raw.trim())),
  v.integer(),
  v.minValue(1),
);

/** Signal the daemon through its pid file; callers only reach this while a socket proves it is live. */
function signalDaemonByProcessId(home: string): boolean {
  const path = pidPath(home);

  if (!existsSync(path)) return false;
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  const parsed = v.safeParse(ProcessIdSchema, raw);

  if (!parsed.success) return false;
  try {
    process.kill(parsed.output);

    return true;
  } catch {
    return false;
  }
}

/** True once the stopped daemon has released its socket; false if it is still there at the deadline. */
async function waitForSocketGone(home: string): Promise<boolean> {
  const path = socketPath(home);
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    if (!existsSync(path)) return true;
    await Bun.sleep(50);
  }

  return !existsSync(path);
}

/**
 * Stop the daemon that owns `home`, returning true once its socket is released.
 * A live daemon is stopped by the owner-gated shutdown request, or, when it
 * refuses the handshake (a version mismatch), by signalling its pid - safe
 * because the socket proves the pid file is current. A home with no socket has
 * no live daemon to stop, so its pid file is never trusted.
 */
export async function stopDaemon(home = cueloopHome()): Promise<boolean> {
  if (!existsSync(socketPath(home))) return false;
  try {
    const client = await DaemonClient.connect({ home, autostart: false });

    await client.shutdown();
    client.close();
  } catch {
    if (!signalDaemonByProcessId(home)) return false;
  }

  return waitForSocketGone(home);
}

/** `cueloop stop` - stop the local daemon. */
export async function stopCommand(): Promise<number> {
  const home = cueloopHome();

  if (!existsSync(socketPath(home))) {
    console.log("no cueloop daemon is running");

    return 0;
  }
  const stopped = await stopDaemon(home);

  console.log(stopped ? "cueloop daemon stopped" : "cueloop daemon did not stop in time");

  return stopped ? 0 : 1;
}

/** `cueloop restart` - stop the local daemon, then autostart a fresh one. */
export async function restartCommand(): Promise<number> {
  const home = cueloopHome();

  await stopDaemon(home);
  const client = await DaemonClient.connect({ home, autostart: true });

  client.close();
  console.log("cueloop daemon restarted");

  return 0;
}
