/**
 * Polls each open PR review for new commits so the review hot-reloads when the
 * PR head advances. A remote PR has no push signal, so this checks the head sha
 * on an interval - one cheap gh call - and only asks the caller to re-pull the
 * full diff when the head actually moved. Best-effort: a missing or failing gh
 * leaves the last known head in place and never throws.
 */

import { prHeadSha } from "./gh";

/** One cheap head-sha check per interval; the expensive full-diff pull happens only on a move. */
const PR_POLL_INTERVAL_MS = 30_000;

interface PrPoll {
  pr: string;
  /** Last head sha seen; null until the baseline check lands, so the first observation never fires. */
  lastSha: string | null;
  timer: ReturnType<typeof setInterval>;
}

export class PrReviewPoller {
  private readonly polls = new Map<string, PrPoll>();

  constructor(
    private readonly onPrAdvance: (sessionId: string) => void,
    private readonly headSha: (pr: string) => Promise<string | null> = prHeadSha,
    private readonly intervalMs: number = PR_POLL_INTERVAL_MS,
  ) {}

  /** Start polling a PR review. Idempotent per session; the baseline check runs at once. */
  trackPr(sessionId: string, pr: string): void {
    if (this.polls.has(sessionId)) return;
    const timer = setInterval(() => void this.refreshHead(sessionId), this.intervalMs);
    // the poll timer must not by itself keep the daemon alive against idle-exit
    timer.unref?.();
    this.polls.set(sessionId, { pr, lastSha: null, timer });
    void this.refreshHead(sessionId);
  }

  /** Check the PR head once; fire onPrAdvance only when it moved off a known baseline. */
  async refreshHead(sessionId: string): Promise<void> {
    const poll = this.polls.get(sessionId);

    if (!poll) return;
    const sha = await this.headSha(poll.pr).catch(() => null);

    if (sha === null) return;
    // the await yields; re-read so an untrack during the call is honoured
    const current = this.polls.get(sessionId);

    if (!current) return;
    if (current.lastSha === null) {
      current.lastSha = sha;

      return;
    }
    if (sha === current.lastSha) return;
    current.lastSha = sha;
    this.onPrAdvance(sessionId);
  }

  untrackPr(sessionId: string): void {
    const poll = this.polls.get(sessionId);

    if (!poll) return;
    clearInterval(poll.timer);
    this.polls.delete(sessionId);
  }

  close(): void {
    for (const poll of this.polls.values()) clearInterval(poll.timer);
    this.polls.clear();
  }
}
