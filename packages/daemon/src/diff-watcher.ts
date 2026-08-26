/**
 * Watches a diff session's repository for working-tree changes and drives the
 * hot-reload: on any change under a repo root that a live diff session tracks,
 * the daemon re-captures that session's diff so the open review updates in place.
 * One recursive fs watcher per repo root - many diff sessions can share a repo -
 * with a debounce so a burst of file writes triggers a single re-capture.
 */

import { watch, type FSWatcher } from "node:fs";
import { sep } from "node:path";

/** Debounce window: a save or a checkout writes many files in a burst; collapse them into one re-capture. */
const DIFF_REFRESH_DEBOUNCE_MS = 300;

/**
 * Paths whose churn must never trigger a diff refresh. git rewrites `.git`
 * metadata (the index, lock files) on every read `cueloop diff` itself runs, so
 * watching it would loop; `node_modules` churns on installs and is never review
 * content.
 */
function isIgnoredWatchPath(relativePath: string): boolean {
  const segments = relativePath.split(sep);
  return segments.includes(".git") || segments.includes("node_modules");
}

interface RepoWatch {
  handle: FSWatcher;
  /** Live diff session ids sharing this repo root; the watch closes when the last one leaves. */
  sessionIds: Set<string>;
  debounce: ReturnType<typeof setTimeout> | null;
}

/**
 * Owns the fs watchers behind diff hot-reload. `onRepoChange` fires once per
 * debounced burst with the repo root that changed; the caller re-captures every
 * live diff session on that root. A watcher error or an unwatchable root is
 * swallowed - hot-reload is best-effort and must never crash the daemon.
 */
export class DiffWatcher {
  private readonly repoWatches = new Map<string, RepoWatch>();

  constructor(private readonly onRepoChange: (repoRoot: string) => void) {}

  /** Start (or join) watching a repo root for one diff session. Idempotent per (root, session). */
  trackDiffRepo(repoRoot: string, sessionId: string): void {
    const existing = this.repoWatches.get(repoRoot);
    if (existing) {
      existing.sessionIds.add(sessionId);
      return;
    }
    let handle: FSWatcher;
    try {
      handle = watch(repoRoot, { recursive: true }, (_event, filename) => {
        if (filename !== null && isIgnoredWatchPath(filename.toString())) return;
        this.scheduleRepoRefresh(repoRoot);
      });
    } catch {
      // repo root gone or not watchable on this platform: skip, no hot-reload here
      return;
    }
    // a watcher error (the root is deleted mid-review) must not take down the
    // daemon; the inherited EventEmitter `on` is absent from Bun's FSWatcher type
    (handle as FSWatcher & { on(event: "error", listener: (error: Error) => void): void }).on(
      "error",
      () => {},
    );
    this.repoWatches.set(repoRoot, { handle, sessionIds: new Set([sessionId]), debounce: null });
  }

  /** Drop one diff session; close the repo watch once no diff session tracks it. */
  untrackDiffRepo(repoRoot: string, sessionId: string): void {
    const repoWatch = this.repoWatches.get(repoRoot);
    if (!repoWatch) return;
    repoWatch.sessionIds.delete(sessionId);
    if (repoWatch.sessionIds.size > 0) return;
    if (repoWatch.debounce !== null) clearTimeout(repoWatch.debounce);
    repoWatch.handle.close();
    this.repoWatches.delete(repoRoot);
  }

  private scheduleRepoRefresh(repoRoot: string): void {
    const repoWatch = this.repoWatches.get(repoRoot);
    if (!repoWatch) return;
    if (repoWatch.debounce !== null) clearTimeout(repoWatch.debounce);
    repoWatch.debounce = setTimeout(() => {
      repoWatch.debounce = null;
      this.onRepoChange(repoRoot);
    }, DIFF_REFRESH_DEBOUNCE_MS);
  }

  /** Close every watcher and cancel pending debounces (daemon shutdown). */
  close(): void {
    for (const repoWatch of this.repoWatches.values()) {
      if (repoWatch.debounce !== null) clearTimeout(repoWatch.debounce);
      repoWatch.handle.close();
    }
    this.repoWatches.clear();
  }
}
