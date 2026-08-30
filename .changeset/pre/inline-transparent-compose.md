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
- Replace the always-on keybind bar with a bottom-left menu that drops up to a
  keybinds cheatsheet and a settings dialog (auto-close and review panel,
  persisted), and show the cueloop version at the bottom-right under the rail.
- Put "Submit review" inline with the rail's collapse chevron on the plan's
  bottom-border row and drop the trailing return glyph.
- Annotation cards share the tab box's width and stack tightly; the keybinds and
  settings dialogs get a solid dark panel so their content stays legible.
- Drop the `⏎` return glyph from every button and hint - the return key reads as
  the word "enter" where a key needs naming, and buttons show their label alone.
