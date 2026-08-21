#!/usr/bin/env bun
/**
 * Detached queue waiter for Codex: park on one review's verdict, then queue it
 * into the running Codex thread with `codex queue`. Spawned right after a
 * non-blocking openReview; the agent ends its turn and this process resumes it
 * with the feedback when the human decides, then exits.
 *   bun run .../codex/wake.ts <sessionId> <threadId> &
 *
 * Weakest native wake path (ADR 0008): needs the driving Codex under the shared
 * app-server daemon and has not been validated against a live codex.
 */

import { wakeMessage } from "../wake-message";
import { runWakeWaiter } from "../wake-waiter";
import { queueCodexMessage } from "./queue";

export interface CodexWakeOptions {
  /** State-dir override; the default resolves CUELOOP_HOME from the environment. */
  home?: string;
  /** Long-poll chunk length for the awaitResolve loop. */
  pollMs?: number;
  /** Codex binary; defaults to "codex" on PATH. */
  codexBin?: string;
  cwd?: string;
  signal?: AbortSignal;
}

/**
 * Wait for the verdict on `sessionId`, then queue it into Codex thread
 * `threadId`. Returns true when a verdict was delivered; rejects when the queue
 * add fails, so a detached run exits non-zero and the failure is visible.
 */
export async function runCodexWake(
  sessionId: string,
  threadId: string,
  options: CodexWakeOptions = {},
): Promise<boolean> {
  return runWakeWaiter(
    sessionId,
    async (verdict) => {
      const result = await queueCodexMessage({
        threadId,
        message: wakeMessage(sessionId, verdict),
        codexBin: options.codexBin,
        cwd: options.cwd,
      });
      if (!result.ok) throw new Error(`codex queue failed: ${result.error}`);
    },
    { home: options.home, pollMs: options.pollMs, signal: options.signal },
  );
}

if (import.meta.main) {
  const [, , sessionId, threadId] = process.argv;
  if (!sessionId || !threadId) {
    console.error("usage: wake.ts <sessionId> <threadId>");
    process.exit(2);
  }
  const delivered = await runCodexWake(sessionId, threadId);
  process.exit(delivered ? 0 : 1);
}
