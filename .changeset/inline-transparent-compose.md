---
"@cueloop/client": minor
---

The diff review composer now opens inline under the line you are commenting on,
the same way the plan composer does, instead of a separate bar at the bottom of
the screen. The bottom `ComposeBar` is gone.

The comment composer also paints nothing by default: the bordered frame floats
over the visible session and the terminal background shows through, matching the
transparent dialogs and chrome. This applies in both the plan and diff views.
