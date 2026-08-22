---
"cueloop": patch
---

Fix the plan-gate review opening no herdr tab when the daemon is stale. Recalling the recorded tab handle from the daemon is now isolated from the tab-open flow, so a daemon that predates the herdr-tab verbs (or any recall failure) degrades to opening a fresh tab instead of silently opening nothing. The store write is likewise best-effort: a failure loses only the liveness-dedup handle, never the already-open tab.
