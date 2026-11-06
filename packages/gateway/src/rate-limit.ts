/**
 * A coarse per-source token bucket for share-create (ADR 0004's abuse bound).
 * In-process and best-effort: it caps how fast one IP can mint blobs, nothing
 * more. `now` is injectable so the refill logic is testable without real time.
 */

export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  private nextSweepAt = 0;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now(),
    private readonly maxSources = 10_000,
    private readonly idleTtlMs = 60_000,
  ) {}

  /** Spend one token for `key`; false when the bucket is empty. */
  take(key: string): boolean {
    const at = this.now();

    if (at >= this.nextSweepAt) {
      this.nextSweepAt = at + 1000;
      const expiryMs = Math.max(this.idleTtlMs, (this.capacity / this.refillPerSecond) * 1000);

      for (const [source, bucket] of this.buckets) {
        if (at - bucket.updatedAt >= expiryMs) this.buckets.delete(source);
      }
    }

    const existing = this.buckets.get(key);

    // Refuse new sources when full rather than evicting an attacker's exhausted bucket.
    if (!existing && this.buckets.size >= this.maxSources) return false;

    const bucket = existing ?? { tokens: this.capacity, updatedAt: at };
    const refilled = Math.min(
      this.capacity,
      bucket.tokens + ((at - bucket.updatedAt) / 1000) * this.refillPerSecond,
    );

    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, updatedAt: at });

      return false;
    }

    this.buckets.set(key, { tokens: refilled - 1, updatedAt: at });

    return true;
  }
}
