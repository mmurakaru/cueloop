/**
 * Watches a diff session's repository for working-tree changes and drives the
 * hot-reload: on any change under a repo root that a live diff session tracks,
 * the daemon re-captures that session's diff so the open review updates in place.
 * One recursive fs watcher per repo root - many diff sessions can share a repo -
 * with a debounce so a burst of file writes triggers a single re-capture.
 */

import { watch, type FSWatcher } from "node:fs";
import { isAbsolute, join, sep } from "node:path";

/** Debounce window: a save or a checkout writes many files in a burst; collapse them into one re-capture. */
const DIFF_REFRESH_DEBOUNCE_MS = 300;

/**
 * Working-tree paths whose churn must never trigger a diff refresh. All of
 * `.git` is excluded from the recursive tree watch - the relevant git metadata
 * is watched narrowly instead (HEAD, refs, packed-refs) so its own read churn
 * (the index, lock files) cannot loop. `node_modules` churns on installs and is
 * never review content.
 */
function isIgnoredWatchPath(relativePath: string): boolean {
  const segments = relativePath.split(sep);

  return segments.includes(".git") || segments.includes("node_modules");
}

/** The git-metadata filenames whose change means `git diff HEAD` moved: a checkout, a commit, or a reset. */
function isRefChange(filename: string): boolean {
  return filename === "HEAD" || filename === "packed-refs";
}

/**
 * A repo's git dir (HEAD and the index live here) and common dir (refs and
 * packed-refs live here). They differ inside a linked worktree. Null when the
 * root is not a git repo or git is unavailable.
 */
function resolveGitDirs(repoRoot: string): { gitDir: string; commonDir: string } | null {
  const result = Bun.spawnSync(["git", "rev-parse", "--absolute-git-dir", "--git-common-dir"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "ignore",
  });

  if (result.exitCode !== 0) return null;
  const [gitDir, commonRaw] = result.stdout.toString().trim().split("\n");

  if (!gitDir) return null;
  const commonDir = commonRaw
    ? isAbsolute(commonRaw)
      ? commonRaw
      : join(repoRoot, commonRaw)
    : gitDir;

  return { gitDir, commonDir };
}

interface RepoWatch {
  /** The recursive working-tree watch plus the narrow git-metadata watches; all close together. */
  handles: FSWatcher[];
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
    const handles: FSWatcher[] = [];

    // the working tree, minus .git and node_modules; a tracked-file change re-captures
    if (
      !this.watchInto(handles, repoRoot, { recursive: true }, (filename) => {
        if (!isIgnoredWatchPath(filename)) this.scheduleRepoRefresh(repoRoot);
      })
    ) {
      // repo root gone or not watchable on this platform: skip, no hot-reload here
      return;
    }

    // git metadata: a commit, checkout, or reset moves `git diff HEAD` without
    // touching any working-tree file, so those never reach the tree watch above.
    const gitDirs = resolveGitDirs(repoRoot);

    if (gitDirs) {
      // HEAD and packed-refs sit beside the index; the index rewrites on our own
      // reads, so only HEAD/packed-refs here - watching the index would loop
      this.watchInto(handles, gitDirs.gitDir, { recursive: false }, (filename) => {
        if (isRefChange(filename)) this.scheduleRepoRefresh(repoRoot);
      });
      // a commit or reset updates refs/heads/<branch>; any ref move re-captures
      this.watchInto(handles, join(gitDirs.commonDir, "refs"), { recursive: true }, () =>
        this.scheduleRepoRefresh(repoRoot),
      );
      if (gitDirs.commonDir !== gitDirs.gitDir)
        this.watchInto(handles, gitDirs.commonDir, { recursive: false }, (filename) => {
          if (isRefChange(filename)) this.scheduleRepoRefresh(repoRoot);
        });
    }

    this.repoWatches.set(repoRoot, { handles, sessionIds: new Set([sessionId]), debounce: null });
  }

  /**
   * Open one watcher and add it to `handles`; returns whether it opened. A
   * watcher error (the path is deleted mid-review) is swallowed - hot-reload is
   * best-effort and must never take down the daemon. The inherited EventEmitter
   * `on` is absent from Bun's FSWatcher type.
   */
  private watchInto(
    handles: FSWatcher[],
    path: string,
    options: { recursive: boolean },
    onFile: (filename: string) => void,
  ): boolean {
    try {
      const handle = watch(path, options, (_event, filename) => {
        if (filename !== null) onFile(filename.toString());
      });

      handle.on("error", () => {});
      handles.push(handle);

      return true;
    } catch {
      return false;
    }
  }

  /** Drop one diff session; close the repo watch once no diff session tracks it. */
  untrackDiffRepo(repoRoot: string, sessionId: string): void {
    const repoWatch = this.repoWatches.get(repoRoot);

    if (!repoWatch) return;
    repoWatch.sessionIds.delete(sessionId);
    if (repoWatch.sessionIds.size > 0) return;
    if (repoWatch.debounce !== null) clearTimeout(repoWatch.debounce);
    for (const handle of repoWatch.handles) handle.close();
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
      for (const handle of repoWatch.handles) handle.close();
    }
    this.repoWatches.clear();
  }
}
