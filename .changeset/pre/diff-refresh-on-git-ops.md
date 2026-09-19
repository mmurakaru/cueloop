---
"cueloop": patch
---

An open working-tree diff now refreshes on commits, checkouts, and resets, not just on file saves. The watcher tracks the repo's git metadata (HEAD, refs, packed-refs) alongside the working tree, so a change that moves `git diff HEAD` without touching a file still updates the review. The index is deliberately left unwatched so the daemon's own reads cannot loop.
