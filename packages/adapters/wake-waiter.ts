/**
 * The detached-waiter core the two external-injection adapters share (the
 * Claude Code inbox socket and the Codex queue). Where pi keeps its waiter
 * in-process, Claude Code and Codex have no long-running extension host, so a
 * detached child process parks here: connect to the daemon, wait for the
 * verdict on one session, then hand the resolved outcome to the harness-native
 * inject. The held connection keeps the daemon off its idle-exit path for the
 * whole wait, and autostart recovers a daemon that died mid-review (the pending
 * session is reloaded from disk).
 */

import { DaemonClient } from "@cueloop/daemon/client";
import { awaitResolve, type VerdictOutcome } from "@cueloop/daemon/review";

export interface WakeWaiterOptions {
  /** State-dir override; the default resolves CUELOOP_HOME from the environment. */
  home?: string;
  /** Long-poll chunk length for the awaitResolve loop. */
  pollMs?: number;
  /** Abort the wait; runWakeWaiter resolves to false without injecting. */
  signal?: AbortSignal;
}

/**
 * Park on one session's verdict, then inject it into the live harness turn.
 * Returns true when a verdict was delivered, false when the wait aborted first.
 */
export async function runWakeWaiter(
  sessionId: string,
  inject: (verdict: VerdictOutcome) => void | Promise<void>,
  options: WakeWaiterOptions = {},
): Promise<boolean> {
  const client = await DaemonClient.connect({ home: options.home, autostart: true });

  try {
    const verdict = await awaitResolve(client, sessionId, {
      pollMs: options.pollMs,
      signal: options.signal,
    });

    if (verdict === null) return false;
    await inject(verdict);

    return true;
  } finally {
    client.close();
  }
}
