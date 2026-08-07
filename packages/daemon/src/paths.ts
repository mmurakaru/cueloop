/**
 * State-dir resolution. Everything the daemon persists lives under one home
 * directory; tests point CUELOOP_HOME at a temp dir to get full isolation.
 */

import { join } from "node:path";
import { homedir } from "node:os";

export function cueloopHome(): string {
  return process.env.CUELOOP_HOME ?? join(homedir(), ".cueloop");
}

export function socketPath(home = cueloopHome()): string {
  return join(home, "cueloop.sock");
}

export function sessionsDir(home = cueloopHome()): string {
  return join(home, "sessions");
}

export function pidPath(home = cueloopHome()): string {
  return join(home, "cueloop.pid");
}
