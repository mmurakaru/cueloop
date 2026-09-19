---
"cueloop": patch
---

A PR review now hot-reloads when the pull request gains new commits: the daemon polls the PR head and re-pulls the diff when it moves, pushing the update to the open review. PR reviews are also kept separate from working-tree diffs, so a local edit can no longer overwrite the PR patch under review.
