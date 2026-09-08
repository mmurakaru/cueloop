---
"@cueloop/schema": minor
"@cueloop/daemon": minor
"@cueloop/client": minor
"cueloop": minor
---

Thread view, discussions, spanning anchors, and realtime share sync.

- An anchor may span consecutive blocks: the quote joins the blocks with a blank line, the end block travels as a hint, and resolution maps a match back to its start and end block.
- A reply carries `replyTo`, the id of the root comment it answers, and shares its anchor; the feedback document renders a discussion as one item with its replies in time order.
- Behind `CUELOOP_THREAD_VIEW=1`, plans and replies open in the thread view: character-precise marks across rows and blocks, type-to-comment, inline discussion cards, folding, the quick-action palette, and scroll markers; the keybinds dialog lists the grammar.
- Shares sync live: the gateway store notifies every viewer of a change, collaborators refresh in place, and the owner follows the share over a `cueloop-watch` stream with reconnect instead of polling.
- Every callable action is a primitive; the gateway share metrics label is `primitive` instead of `verb`.
