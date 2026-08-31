---
"cueloop": patch
---

Fixed herdr auto-open silently doing nothing. The `tab create` response parser expected `result.pane.id`, but real herdr (0.8.0) returns `result.root_pane.pane_id` - so a review created inside herdr never actually opened its tab. Verified against the real binary; the test stub now mirrors the real output shape.
