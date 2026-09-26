/**
 * Watches a diff session's repository for working-tree changes and drives the
 * hot-reload: on any change under a repo root that a live diff session tracks,
 * the daemon re-captures that session's diff so the open review updates in place.
 * One watcher per non-ignored directory (not a recursive watch), so churn under
 * `.git`, `node_modules`, or a .gitignored path never registers a watch at all -
 * that keeps idle cost near zero on Linux, where a recursive watch would open an
 * inotify descriptor per directory. A debounce collapses a burst into one
 * re-capture. Many diff sessions can share a repo.
 */

import { watch, readdirSync, statSync, type Dirent, type FSWatcher } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

/** Debounce window: a save or a checkout writes many files in a burst; collapse them into one re-capture. */
const DIFF_REFRESH_DEBOUNCE_MS = 300;

/**
 * Directory names never worth a watch, whatever .gitignore says. `.git` is
 * watched narrowly elsewhere (HEAD, refs, packed-refs) so its own read churn (the
 * index, lock files) cannot loop; `node_modules` churns on installs and is never
 * review content.
 */
const ALWAYS_IGNORED_DIRS = new Set([".git", ".jj", "node_modules"]);

/**
 * Absolute paths of the directories git ignores under a repo root, resolved once
 * at watch time from `git ls-files` so a .gitignored tree (dist, build output)
 * never gets a watcher. Empty when git is unavailable - the name check still
 * skips the churny defaults.
 */
function ignoredDirectories(repoRoot: string): Set<string> {
  const ignored = new Set<string>();
  const result = spawnGit(
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
    repoRoot,
  );

  if (!result || result.exitCode !== 0) return ignored;
  for (const line of result.stdout.toString().split("\n")) {
    const relative = line.trim().replace(/\/$/, "");

    if (relative.length > 0) ignored.add(join(repoRoot, relative));
  }

  return ignored;
}

/** Whether git ignores a single path; used for a directory created after the initial walk. */
function isGitIgnored(repoRoot: string, path: string): boolean {
  return spawnGit(["check-ignore", "-q", path], repoRoot)?.exitCode === 0;
}

/** Run a git command in `cwd`, or null when git is missing or the cwd is gone (spawn throws ENOENT). */
function spawnGit(args: string[], cwd: string): { exitCode: number; stdout: Buffer } | null {
  try {
    const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });

    return { exitCode: result.exitCode ?? 1, stdout: result.stdout };
  } catch {
    return null;
  }
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
  const result = spawnGit(["rev-parse", "--absolute-git-dir", "--git-common-dir"], repoRoot);

  if (!result || result.exitCode !== 0) return null;
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
  /** One watcher per watched working-tree directory plus the narrow git-metadata watches; all close together. */
  handles: FSWatcher[];
  /** Live diff session ids sharing this repo root; the watch closes when the last one leaves. */
  sessionIds: Set<string>;
  jjSessionIds: Set<string>;
  jjPoll: ReturnType<typeof setInterval> | null;
  /** Absolute paths git ignores under the root, so the walk skips them. */
  ignored: Set<string>;
  /** Directories already watched, so a runtime-created dir is not watched twice. */
  watchedDirs: Set<string>;
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
  trackDiffRepo(repoRoot: string, sessionId: string, vcs = "git"): void {
    const existing = this.repoWatches.get(repoRoot);

    if (existing) {
      existing.sessionIds.add(sessionId);
      if (vcs === "jj") this.startJjPoll(existing, repoRoot, sessionId);

      return;
    }
    const repoWatch: RepoWatch = {
      handles: [],
      sessionIds: new Set([sessionId]),
      jjSessionIds: new Set(),
      jjPoll: null,
      ignored: ignoredDirectories(repoRoot),
      watchedDirs: new Set(),
      debounce: null,
    };

    this.repoWatches.set(repoRoot, repoWatch);
    if (vcs === "jj") this.startJjPoll(repoWatch, repoRoot, sessionId);

    // one watcher per non-ignored working-tree directory; a tracked-file change re-captures
    if (!this.watchTree(repoRoot, repoRoot)) {
      // repo root gone or not watchable on this platform: skip, no hot-reload here
      this.untrackDiffRepo(repoRoot, sessionId);

      return;
    }

    // git metadata: a commit, checkout, or reset moves `git diff HEAD` without
    // touching any working-tree file, so those never reach the tree watch above.
    const gitDirs = resolveGitDirs(repoRoot);

    if (gitDirs) {
      // HEAD and packed-refs sit beside the index; the index rewrites on our own
      // reads, so only HEAD/packed-refs here - watching the index would loop
      this.watchInto(repoWatch.handles, gitDirs.gitDir, { recursive: false }, (filename) => {
        if (isRefChange(filename)) this.scheduleRepoRefresh(repoRoot);
      });
      // a commit or reset updates refs/heads/<branch>; any ref move re-captures
      this.watchInto(repoWatch.handles, join(gitDirs.commonDir, "refs"), { recursive: true }, () =>
        this.scheduleRepoRefresh(repoRoot),
      );
      if (gitDirs.commonDir !== gitDirs.gitDir)
        this.watchInto(repoWatch.handles, gitDirs.commonDir, { recursive: false }, (filename) => {
          if (isRefChange(filename)) this.scheduleRepoRefresh(repoRoot);
        });
    }
  }

  private startJjPoll(repoWatch: RepoWatch, repoRoot: string, sessionId: string): void {
    repoWatch.jjSessionIds.add(sessionId);
    if (repoWatch.jjPoll !== null) return;
    repoWatch.jjPoll = setInterval(() => this.scheduleRepoRefresh(repoRoot), 2000);
  }

  /**
   * Watch `dir` (non-recursive) and every non-ignored directory under it, adding
   * each to the repo's handles. Returns whether `dir` itself got a watcher, so
   * the caller can tell a dead root from a merely-skipped subtree. A skipped
   * (ignored or already-watched) directory counts as watched, not a failure.
   */
  private watchTree(repoRoot: string, dir: string): boolean {
    const repoWatch = this.repoWatches.get(repoRoot);

    if (!repoWatch) return false;
    if (repoWatch.watchedDirs.has(dir)) return true;
    if (ALWAYS_IGNORED_DIRS.has(basename(dir)) || repoWatch.ignored.has(dir)) return true;

    const opened = this.watchInto(repoWatch.handles, dir, { recursive: false }, (filename) => {
      this.scheduleRepoRefresh(repoRoot);
      // a newly created subdirectory needs its own watch (a recursive watch got this for free)
      this.extendWatch(repoRoot, join(dir, filename));
    });

    if (!opened) return false;
    repoWatch.watchedDirs.add(dir);

    let entries: Dirent[];

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      // a symlinked directory is skipped so the walk cannot loop
      if (entry.isDirectory() && !entry.isSymbolicLink())
        this.watchTree(repoRoot, join(dir, entry.name));
    }

    return true;
  }

  /**
   * After a change names a new path, watch it (and its subtree) when it is a
   * directory git does not ignore. The point-in-time ignored set cannot know a
   * directory created after the walk, so a fresh dir is checked against git live.
   */
  private extendWatch(repoRoot: string, path: string): void {
    try {
      if (!statSync(path).isDirectory()) return;
    } catch {
      // the path is already gone (a transient temp dir); nothing to watch
      return;
    }
    if (ALWAYS_IGNORED_DIRS.has(basename(path))) return;
    if (isGitIgnored(repoRoot, path)) return;
    this.watchTree(repoRoot, path);
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
    repoWatch.jjSessionIds.delete(sessionId);
    if (repoWatch.jjSessionIds.size === 0 && repoWatch.jjPoll !== null) {
      clearInterval(repoWatch.jjPoll);
      repoWatch.jjPoll = null;
    }
    if (repoWatch.sessionIds.size > 0) return;
    if (repoWatch.debounce !== null) clearTimeout(repoWatch.debounce);
    if (repoWatch.jjPoll !== null) clearInterval(repoWatch.jjPoll);
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
      if (repoWatch.jjPoll !== null) clearInterval(repoWatch.jjPoll);
      for (const handle of repoWatch.handles) handle.close();
    }
    this.repoWatches.clear();
  }
}
