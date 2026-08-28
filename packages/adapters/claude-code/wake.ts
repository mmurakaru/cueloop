#!/usr/bin/env bun
/**
 * Detached inbox waiter for Claude Code: park on one review's verdict, then post
 * it into the live session over the inbox socket. Spawned as a child of the
 * Claude Code session - so it inherits CLAUDE_CODE_MESSAGING_SOCKET and
 * CLAUDE_CODE_MESSAGING_TOKEN - right after a non-blocking openReview. The agent
 * ends its turn and keeps chatting; this process resumes it with the feedback
 * when the human decides, then exits. No-op when the session is not
 * messaging-enabled (nothing to wake).
 *
 * Wire it into the plan skill's non-blocking path:
 *   bun run .../claude-code/wake.ts <sessionId> &   # detached, inherits the socket env
 */

import { wakeMessage } from "../wake-message";
import { runWakeWaiter } from "../wake-waiter";
import { claudeInboxFromEnv, postToInbox, type ClaudeInbox } from "./inbox";

export interface InboxWakeOptions {
  /** State-dir override; the default resolves CUELOOP_HOME from the environment. */
  home?: string;
  /** Long-poll chunk length for the awaitResolve loop. */
  pollMs?: number;
  /** Inbox override for tests; defaults to the coordinates in the environment. */
  inbox?: ClaudeInbox | null;
  signal?: AbortSignal;
}

/**
 * Wait for the verdict on `sessionId`, then post it to the Claude Code inbox.
 * Returns true when a verdict was delivered, false when the session is not
 * messaging-enabled or the wait aborted first.
 */
export async function runInboxWake(
  sessionId: string,
  options: InboxWakeOptions = {},
): Promise<boolean> {
  const inbox = options.inbox === undefined ? claudeInboxFromEnv() : options.inbox;

  if (!inbox) return false; // not a messaging-enabled Claude Code session

  return runWakeWaiter(
    sessionId,
    (verdict) => postToInbox(inbox, wakeMessage(sessionId, verdict)),
    { home: options.home, pollMs: options.pollMs, signal: options.signal },
  );
}

if (import.meta.main) {
  const sessionId = process.argv[2];

  if (!sessionId) {
    console.error("usage: wake.ts <sessionId>");
    process.exit(2);
  }
  const delivered = await runInboxWake(sessionId);

  process.exit(delivered ? 0 : 1);
}
