---
"cueloop": patch
---

Re-planning in the same session now reliably shows the review in a herdr tab. Before, the auto-tab opened only for a brand-new review, so a resubmit whose original tab had been closed left an orphaned pending review with nothing on screen. cueloop now records the exact tab it opened (tab id + root pane id) in a herdr-namespaced daemon side-store - the core session model stays herdr-free - and on a resubmit checks that pane's liveness by id: a still-open tab is focused, a closed one is reopened, so there is never a duplicate and never a missing tab. Collision-free because it tracks the real ids, not a label.
