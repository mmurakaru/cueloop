---
"cueloop": minor
---

Rejected diff hunks and cut plan blocks now appear in the review rail as their own cards, interleaved with annotation cards in reading order rather than grouped at the bottom. Each removal card previews the removed content struck through and dimmed; selecting one reveals its source line and shows an undo button (the same restore path as the `u` key), so a rejection reads like any other queued item you can take back before you submit. Inline, a cut span is now simply struck through and grayed rather than boxed with a `[cut]` tag, and saved annotation cards carry a uniform bordered frame titled `ACTION · author`. The composer's Cancel button drops its redundant ` esc` hint (esc still cancels).

Keyboard scrolling in the diff sheet is now smooth: the layout model counted a wrapped annotation body or file header as one row while it rendered as several, so the cursor-follow scroll drifted and shifted the view. Those content lines no longer wrap, so the scroll target matches the real layout and the cursor holds a stable screen row.
