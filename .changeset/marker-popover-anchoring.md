---
"cueloop": patch
---

The marker popover now floats one row above the marked words, mapped through the word-wrap geometry, instead of drifting to the block's linear character offset; it paints over neighboring blocks and tracks the content when scrolled. A drag released outside a block's text (the gutter, past a line end, a gap between blocks) now still opens the span popover.
