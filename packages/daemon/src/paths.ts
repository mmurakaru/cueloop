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

export function reportsDir(home = cueloopHome()): string {
  return join(home, "reports");
}

export function pidPath(home = cueloopHome()): string {
  return join(home, "cueloop.pid");
}

export function lockPath(home = cueloopHome()): string {
  return join(home, "cueloop.lock");
}

/** The secret a connection presents to be the owner; written by the daemon, mode 0600. */
export function ownerTokenPath(home = cueloopHome()): string {
  return join(home, "owner.token");
}

/** Adapter scratch: herdr tab handles keyed by session id, kept out of the core session record. */
export function herdrTabsPath(home = cueloopHome()): string {
  return join(home, "herdr-tabs.json");
}
