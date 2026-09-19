---
"cueloop": patch
---

The working-tree diff watcher now registers a watcher per non-ignored directory instead of one recursive watch, skipping `.git`, `node_modules`, and .gitignored trees at registration. On Linux this stops the watcher from opening an inotify descriptor per ignored directory and waking on their churn, so an open review costs nothing while build output changes. A directory created after the review opened is still watched (a fresh ignored one is not).
