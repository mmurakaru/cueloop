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

/** Thread files live here, one JSONL per thread, under a per-project bucket. */
export function threadsDir(home = cueloopHome()): string {
  return join(home, "threads");
}

/** A git commit is lowercase hex; anything else is not a real root commit. */
const COMMIT_SHA = /^[0-9a-f]{7,64}$/;

/**
 * The per-project bucket for a workspace: its durable root-commit SHA, or a shared standalone bucket.
 * A value that is not a commit SHA (including path-traversal segments an IPC caller could smuggle in)
 * is refused to the standalone bucket, so a bucket name can never escape the threads directory.
 */
export function threadBucket(rootCommit: string | undefined, home = cueloopHome()): string {
  const bucket =
    rootCommit && COMMIT_SHA.test(rootCommit) ? rootCommit.slice(0, 12) : "_standalone";

  return join(threadsDir(home), bucket);
}

/** Where the one-time migration parks the old whole-record JSON files, so a downgrade can still read them. */
export function migratedSessionsDir(home = cueloopHome()): string {
  return join(home, "sessions.migrated");
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

/** Harness bindings and Message deliveries, stored independently of Thread records. */
export function harnessStatePath(home = cueloopHome()): string {
  return join(home, "harness-state.json");
}
