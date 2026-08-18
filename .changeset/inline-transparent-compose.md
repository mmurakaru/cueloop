---
"@cueloop/client": minor
---

Review surface refresh, all on the transparent theme:

- The comment composer opens inline under the line you are commenting on in
  both the plan and diff views (the bottom `ComposeBar` is gone), and paints no
  background - a bordered frame floats over the visible session.
- The plan and diff bodies now sit in a bordered frame whose border takes the
  document text colour. The header collapses to one flat inline row
  (`cueloop · title · rev · submitted by …`) with **Edit** and **Share** pinned
  to the plan sheet's top-right corner.
- The rail's Review/Agent tabs are a full-width rounded box with no fill; the
  active tab reads in the accent. The resize divider is invisible (the plan's
  right border is the seam) but still drag-resizes. The empty state centres in
  the rail, and the rail body aligns under the tab labels.
- Your own annotations tag as `me` in the accent once a collaborator has also
  left a note; collaborator notes keep their blue name-in-border card.
- Share now surfaces the ssh link as a centred, auto-dismissing toast (a new
  `Toast` primitive) instead of an inline status line. The submit-review card is
  transparent like the other dialogs.
