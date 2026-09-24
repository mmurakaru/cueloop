/**
 * Polls each open PR review for new commits. A remote PR has no push signal, so
 * this checks its base/head pair on an interval and only exposes refresh when
 * either side moved. Best-effort: a missing or failing gh keeps the last refs.
 */

import { prRefs, type PullRequestRefs } from "./gh";

/** One cheap refs check per interval; the expensive full-diff pull happens only on a move. */
const PR_POLL_INTERVAL_MS = 30_000;

interface PrPoll {
  pr: string;
  /** Last refs seen; null until the baseline check lands, so the first observation never fires. */
  lastRefs: PullRequestRefs | null;
  timer: ReturnType<typeof setInterval>;
}

export class PrReviewPoller {
  private readonly polls = new Map<string, PrPoll>();

  constructor(
    private readonly onPrAdvance: (sessionId: string, refs: PullRequestRefs) => void,
    private readonly refs: (pr: string) => Promise<PullRequestRefs | null> = prRefs,
    private readonly intervalMs: number = PR_POLL_INTERVAL_MS,
  ) {}

  /** Start polling a PR review. Idempotent per session; the persisted reviewed head is the baseline. */
  trackPr(sessionId: string, pr: string, reviewedRefs: PullRequestRefs | null = null): void {
    if (this.polls.has(sessionId)) return;
    const timer = setInterval(() => void this.refreshHead(sessionId), this.intervalMs);
    // the poll timer must not by itself keep the daemon alive against idle-exit
    timer.unref?.();
    this.polls.set(sessionId, { pr, lastRefs: reviewedRefs, timer });
    void this.refreshHead(sessionId);
  }

  /** Check the PR refs once; fire onPrAdvance only when they moved off a known baseline. */
  async refreshHead(sessionId: string): Promise<void> {
    const poll = this.polls.get(sessionId);

    if (!poll) return;
    const refs = await this.refs(poll.pr).catch(() => null);

    if (refs === null) return;
    // the await yields; re-read so an untrack during the call is honoured
    const current = this.polls.get(sessionId);

    if (!current) return;
    if (current.lastRefs === null) {
      current.lastRefs = refs;

      return;
    }
    if (refs.baseSha === current.lastRefs.baseSha && refs.headSha === current.lastRefs.headSha)
      return;
    current.lastRefs = refs;
    this.onPrAdvance(sessionId, refs);
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
