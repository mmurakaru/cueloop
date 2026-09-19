# Working-tree hot-reload: zero-idle-cost file watching

## Question

How can cueloop watch the current git checkout for on-disk changes and hot-reload its
views (the working-tree "Changes" diff especially) with effectively zero steady-state
CPU or battery cost, so agent edits, user saves, and git operations refresh the TUI
with no manual reload and no polling?

Important: a working hot-reload already ships. This note grounds in it, measures it
against the zero-cost bar, and records the two gaps an implementation PR must close.

---

## 1. How cueloop produces and refreshes the working-tree diff today

### Capture (shells out to git, no fs watching in this layer)

`packages/daemon/src/working-tree.ts` builds the diff by spawning git:

- `workingChangeList` runs `git diff --name-status HEAD` plus
  `git ls-files --others --exclude-standard` for untracked files
  (`working-tree.ts:29-49`).
- `workingTreeDiff` runs `git diff HEAD` for the patch, reads full old/new contents
  per changed file via `git show HEAD:<path>` and `Bun.file(...).text()`
  (`working-tree.ts:52-70`, `:89-113`), and appends untracked files with
  `git diff --no-index -- /dev/null <file>` (`working-tree.ts:121-149`).

The diff is always computed against `HEAD` (`git diff HEAD`), so it reflects both
staged and unstaged changes. A commit or checkout moves `HEAD`, which changes this
output - a fact that matters for gap A below.

### Refresh model: event-driven fs watcher already exists (not a timer, not a poll)

- `packages/daemon/src/diff-watcher.ts` owns the watchers. It calls
  `watch(repoRoot, { recursive: true }, ...)` from `node:fs` - one recursive watcher
  per repo root, shared across all diff sessions on that root (`diff-watcher.ts:57`).
- On a change it debounces `DIFF_REFRESH_DEBOUNCE_MS = 300` ms (trailing) and fires
  `onRepoChange(repoRoot)` once per burst (`diff-watcher.ts:13`, `:83-92`).
- `isIgnoredWatchPath` drops events whose path contains a `.git` or `node_modules`
  segment (`diff-watcher.ts:21-25`, applied in the callback at `:58`).
- Watcher errors and unwatchable roots are swallowed - hot-reload is best-effort and
  never crashes the daemon (`diff-watcher.ts:61-67`).

Lifecycle (this is what makes it zero-cost when idle):

- A watcher is registered only for a *live* diff session, defined as
  `status === "pending" && artifact.type === "diff"` (`api.ts:979-981`).
- Registered on session create / daemon load / fork (`api.ts:104`, `:155`, `:792`,
  `watchIfDiffSession` at `:846-849`).
- Torn down on resolve / delete / any non-diff transition
  (`unwatchIfDiffSession` at `:851-854`, called `:451`, `:615`), and all watchers
  close on `dispose()` (`api.ts:107-110`, `diff-watcher.ts:94-101`).
- So with no open diff review, there are zero watchers and zero idle cost.

Re-capture on change:

- `refreshDiffsForRepo` re-captures every live diff session on the changed root
  (`api.ts:830-844`).
- `sessionRefreshDiff` re-runs `workingTreeDiff`, and - crucially - only emits when
  the patch text actually moved: `if (diff.patch === current.artifact.content) return
  { changed: false }` (`api.ts:818`). It carries a generation guard so overlapping
  captures cannot regress the stored artifact (`api.ts:804-813`).

### Transport: the daemon pushes, the client does not poll

- The client opens a persistent socket and calls `events.subscribe`
  (`client.ts:377-379`); the daemon marks the connection subscribed
  (`server.ts:287-289`).
- `sessionRefreshDiff` calls `this.emit("session.updated", id)` (`api.ts:825`), which
  the server broadcasts to every subscribed connection (`server.ts:79`, `:217-220`).
- The client controller receives it and re-fetches the session; for `session.updated`
  it deliberately skips the inbox refresh to avoid a request storm during an active
  review (`thread-controller.ts:498-499`).

### Client derivation reuse (so a refresh is cheap to render)

`packages/client/src/thread-controller.ts` memoizes derived state so a refresh reuses
work instead of recomputing everything:

- `derivedCache` is a bounded `Map<sessionId, DerivedCacheEntry>`
  (`thread-controller.ts:444`, `DERIVED_CACHE_LIMIT` eviction at `:657-661`).
- `ensureDerived()` recomputes only when the cache is stale for the current session
  (`thread-controller.ts:602-661`).
- `fileModel(path)` parses a changed file's model on first touch and memoizes it
  (`thread-controller.ts:385`, `:587-600`).

Current-state summary: refresh is event-driven, not timed. A recursive `fs.watch`
per open diff repo (`diff-watcher.ts:57`) drives `sessionRefreshDiff` after a 300 ms
debounce; the daemon pushes `session.updated` over the subscribe socket and the client
re-derives through `derivedCache`. Zero watchers exist when no diff review is open.

---

## 2. Watching options and their real idle-cost characteristics

### `node:fs` / Bun `fs.watch({ recursive: true })` - what cueloop uses

- macOS: maps to **FSEvents**. FSEvents is event-driven and coalesced - the kernel
  batches change notifications at directory granularity and delivers nothing while the
  tree is idle, so idle CPU is effectively zero and a single watch covers the whole
  subtree. Node's own docs state macOS `fs.watch` uses FSEvents.
  Sources: [Node fs.watch caveats](https://nodejs.org/api/fs.html#caveats),
  [Apple FSEvents Programming Guide](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/Introduction/Introduction.html).
- Linux: the kernel `inotify` API is **not recursive** - it watches one directory per
  watch descriptor. Node added recursive support in the v20 line (PR #45098, commit
  `34bfef9`) in **userspace**: `lib/internal/fs/recursive_watch.js` walks the tree and
  adds one inotify watch per directory. Bun implements its own recursive Linux path
  (e.g. PR [oven-sh/bun#43090](https://github.com/oven-sh/bun/pull/43090)); cueloop
  runs Bun 1.4.2, which supports `recursive: true` on both macOS and Linux
  ([Bun watch guide](https://bun.com/guides/read-file/watch), verified by the passing
  `diff-hot-reload.test.ts` watcher test).
  Sources: [Node "add recursive watch to linux" commit](https://github.com/nodejs/node/commit/34bfef91a9),
  [nodejs/node#36005](https://github.com/nodejs/node/issues/36005).
- Idle cost is near-zero on both once established: inotify is edge-triggered and quiet
  while idle. The cost on Linux is *setup and descriptors*, not idle CPU.

### macOS FSEvents vs Linux inotify - the asymmetry that matters

- FSEvents: one watch = whole subtree, coalesced, near-zero idle, no per-directory
  descriptor cost. Recursive watching a large repo (incl. `node_modules`) is cheap.
- inotify: one watch descriptor per directory. A recursive watch of a repo with a big
  `node_modules` (10k+ dirs) can exhaust `fs.inotify.max_user_watches` (default
  **8192**), and directories past the cap are silently never watched; `inotify_add_watch`
  fails with **ENOSPC** at the limit.
  Sources: [inotify(7) man page](https://man7.org/linux/man-pages/man7/inotify.7.html),
  [Watchexec inotify limits](https://watchexec.github.io/docs/inotify-limits.html).

Consequence for cueloop: the current `isIgnoredWatchPath` filter runs **in the event
callback**, after watches are already registered (`diff-watcher.ts:58`). On macOS that
is fine (single FSEvents watch). On Linux the userspace walker still registers inotify
watches on `node_modules` and other ignored trees, wasting descriptors and waking the
process on churn even though the event is later discarded. Ignoring must happen at the
*walk/registration* step to matter on Linux.

### git-aware watching: `core.fsmonitor` / `git fsmonitor--daemon`

Git ships a long-running filesystem monitor: `git fsmonitor--daemon` listens for OS
change events (inotify on Linux, FSEvents via a Unix domain socket on macOS) and
maintains an in-memory list of recently changed paths, so `git status` can skip the
disk scan. Enabled with `core.fsmonitor = true`.
Sources: [git-fsmonitor--daemon(1)](https://git-scm.com/docs/git-fsmonitor--daemon),
[GitHub Blog: fsmonitor](https://github.blog/engineering/infrastructure/improve-git-monorepo-performance-with-a-file-system-monitor/).

Weighing it for cueloop: fsmonitor speeds up the `git diff HEAD` *re-capture*, but it
is a per-user opt-in git config, not a change *notification channel* cueloop can
subscribe to, and it does not remove cueloop's own need to know "something changed, go
re-capture." It is complementary (a repo may already have it on, which makes our
re-capture cheaper) but not a substitute for the fs watcher. Recommendation: do not
depend on it; benefit from it transparently when present.

### chokidar / Watchman as references

- chokidar v4 dropped its bundled `fsevents` native dep and now wraps native
  `fs.watch`/`fs.watchFile` (1 dependency, down from 13). It avoids polling by
  default and adds normalization, `ignored` globs applied at traversal, and debounce.
  Source: [chokidar](https://www.npmjs.com/package/chokidar),
  [paulmillr/chokidar](https://github.com/paulmillr/chokidar).
- Watchman (Meta) is a separate daemon with its own IPC and ignore rules; low idle
  cost but a heavyweight external dependency.

For a lean tool the native `fs.watch` primitive cueloop already uses is the right base;
chokidar's *technique* (ignore at traversal, debounce, stat-normalize) is worth
copying, but adopting the dependency is not justified for a single-repo watch. Watchman
is out of scope.

### Which `.git` files signal commits / checkouts / staging

To catch operations that change `git diff HEAD` without touching working-tree files:

- `.git/HEAD` - branch switch / checkout (symref target changes).
- `.git/index` - staging (`git add`, `git reset`), and part of commit.
- `.git/refs/heads/<branch>` (and the packed form `.git/packed-refs`) - a commit moves
  the branch tip, moving HEAD's resolved commit.

Watching the whole `.git` directory is the wrong move (git rewrites lock files and
internal objects constantly, which is exactly why the current code ignores it); watch
only these specific ref/index files.

---

## 3. Recommended design for cueloop

The architecture is already correct: event-driven, daemon-side, per-open-review,
push-over-socket, patch-equality gated, client re-derives through `derivedCache`. Keep
all of that. Two concrete changes close the correctness and Linux-cost gaps, plus two
optional refinements.

### Primitive and placement (keep as-is)

- Keep native `fs.watch` (FSEvents on macOS, Bun's recursive inotify on Linux). No new
  dependency.
- Keep the watcher in the **daemon** (`diff-watcher.ts`): one daemon serves many
  clients, the daemon already owns capture and the push socket, and lifecycle is tied
  to live diff sessions. A client-side watcher would duplicate work per viewer and
  cannot see other agents' edits when reviewing over the share transport.
- Keep the "watch only while a live diff session is pending" lifecycle
  (`api.ts:846-854`) - this is what delivers zero idle cost when nothing is under
  review.

### Gap A (correctness, do this): also refresh on commit / checkout / staging

Today `isIgnoredWatchPath` drops **every** `.git` path (`diff-watcher.ts:21-25`), so a
`git commit`, `git checkout`, or `git add` does not refresh the review even though
`git diff HEAD` changed. Add a narrow, explicit watch on the git metadata that matters:

- Register a second, **non-recursive** `fs.watch` on the repo's `.git` directory (or
  the resolved `$GIT_DIR`), and inside the callback act only on `HEAD`, `index`,
  `packed-refs`, and paths under `refs/` (via `git rev-parse --git-dir` to handle
  worktrees / submodules). Route those through the same debounced
  `scheduleRepoRefresh`.
- Keep ignoring the rest of `.git` (objects, lock files) to avoid the self-trigger loop
  the current comment warns about (`diff-watcher.ts:15-20`).
- The existing patch-equality gate (`api.ts:818`) means a spurious `.git` wake that did
  not change the diff still costs nothing downstream (no event emitted).

### Gap B (Linux cost, do this): ignore at registration, not in the callback

Move ignore filtering to the traversal/registration step so ignored trees never get an
inotify watch on Linux:

- Prefer not watching the repo root recursively at all. Instead, drive the watch set
  from the working-set git already computes - or at minimum exclude `node_modules`,
  `.git`, and `dist`/build outputs before descending. On macOS the single FSEvents
  watch makes this less critical, but registration-time ignore is what prevents ENOSPC
  and node_modules-churn wakeups on Linux.
- Respect `.gitignore` so build-output churn (e.g. `dist/`) never wakes the watcher.
  `workingTreeDiff` already filters ignored files via git, so today such churn wakes
  the process and shells git only to find `changed: false` - wasted work the
  registration-time ignore removes.

### Debounce and coalescing (keep, minor tune)

- Keep the trailing debounce (`diff-watcher.ts:83-92`); 300 ms is reasonable. A save
  or checkout writes a burst; one re-capture per burst is correct. If refreshes ever
  feel laggy, 100-150 ms is still comfortably within "coalesce a burst" territory.

### Push and cache reuse (keep as-is)

- Keep pushing `session.updated` over the subscribe socket (`api.ts:825`,
  `server.ts:217-220`); no polling anywhere.
- Keep the client's `session.updated` re-fetch that skips the inbox refresh
  (`thread-controller.ts:498-499`) and re-derives through `derivedCache` /
  `fileModel` (`thread-controller.ts:587-661`).

### Optional refinement: pause when the review is open but not focused

The watcher runs for every pending diff session even when the user has navigated to a
different thread. Re-captures are cheap and gated, so this is not urgent, but if
battery in long multi-review sessions matters, the watcher could suspend when the diff
thread is not the focused view and re-capture once on refocus. This is an optimization,
not a correctness need; the zero-cost-when-no-review-open property already holds.

---

## 4. Risks and edge cases

- **Linux recursive availability**: Bun 1.4.2 supports `recursive: true` on Linux, but
  it is a userspace walk; treat a `watch()` throw as "no hot-reload here" (already
  handled, `diff-watcher.ts:61-64`). The registration-time ignore (Gap B) is what
  keeps that walk cheap.
- **inotify descriptor exhaustion (ENOSPC)**: without registration-time ignore, a big
  `node_modules` can blow past `max_user_watches` (default 8192), silently dropping
  watches on the paths that matter. Gap B fixes this; do not paper over it by telling
  users to raise the sysctl.
- **Large repos**: FSEvents scales fine on macOS; on Linux, watch only tracked/working
  paths, not the whole tree.
- **Symlinks**: Bun's Linux recursive symlink behavior has shifted across 1.3.x
  releases ([oven-sh/bun#43090](https://github.com/oven-sh/bun/pull/43090),
  [#43066](https://github.com/oven-sh/bun/issues/43066)); do not rely on watching
  through symlinked directories. Missed events behind a symlink degrade to "no
  refresh", which is acceptable (best-effort).
- **Rename / move storms**: the debounce coalesces bursts; the patch-equality gate
  drops no-op captures. A branch-switch rewrites many files - one debounced re-capture
  handles it, and Gap A ensures the HEAD move itself triggers it.
- **.gitignore churn**: build outputs under an ignored dir currently wake the watcher
  and shell git for nothing; Gap B (respect `.gitignore` at registration) removes it.
- **`.git` self-trigger loop**: `cueloop diff` runs git, which rewrites `.git` lock
  files; the narrow `.git` watch in Gap A must whitelist only `HEAD`/`index`/`refs`/
  `packed-refs`, never the whole directory, or the re-capture will re-trigger itself.
- **git worktrees / submodules**: resolve the real git dir (`git rev-parse --git-dir`)
  before watching `.git`, because it is a file (a gitdir pointer), not a directory, in
  linked worktrees and submodules.

---

## Sources

- [Node.js fs.watch caveats and platform primitives](https://nodejs.org/api/fs.html#caveats)
- [Node.js "fs: add recursive watch to linux" commit 34bfef9 (PR #45098)](https://github.com/nodejs/node/commit/34bfef91a9)
- [nodejs/node#36005 - Recursive fs.watch for linux](https://github.com/nodejs/node/issues/36005)
- [Bun watch guide](https://bun.com/guides/read-file/watch)
- [oven-sh/bun#43090 - recursive symlink watching on Linux](https://github.com/oven-sh/bun/pull/43090)
- [oven-sh/bun#43066 - Linux recursive root event differences](https://github.com/oven-sh/bun/issues/43066)
- [inotify(7) man page](https://man7.org/linux/man-pages/man7/inotify.7.html)
- [Watchexec: Linux inotify limits](https://watchexec.github.io/docs/inotify-limits.html)
- [Apple FSEvents Programming Guide](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/Introduction/Introduction.html)
- [git-fsmonitor--daemon(1)](https://git-scm.com/docs/git-fsmonitor--daemon)
- [GitHub Blog: improve monorepo performance with a filesystem monitor](https://github.blog/engineering/infrastructure/improve-git-monorepo-performance-with-a-file-system-monitor/)
- [chokidar on npm](https://www.npmjs.com/package/chokidar)
- [paulmillr/chokidar](https://github.com/paulmillr/chokidar)
