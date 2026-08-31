---
"cueloop": patch
---

A working-tree diff review now hot-reloads: while you have a `cueloop diff` session open, the daemon watches its repository and re-captures the diff whenever the working tree changes, so the review updates in place with no manual reload and no remount. Your annotations re-anchor across the refreshed patch through the usual anchor cascade. The daemon runs one recursive watcher per repository shared by its live diff sessions, debounces bursts of file writes into a single re-capture, ignores churn under `.git/` and `node_modules/`, and only broadcasts when the patch actually moved. A new owner-only `session.refreshDiff` verb is the seam the watcher drives and is scriptable on its own. Watching starts when a diff session is created (or recovered after a daemon restart) and stops when it resolves, is deleted, or the daemon shuts down.
