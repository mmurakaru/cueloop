---
"cueloop": minor
---

Add the marker-actions popover to plan review: marking a span (`v`) now shows an inline toolbar at the block - `comment · cut · actions · [x]` - each label keyboard-shortcut-backed and clickable, so span mode is discoverable rather than blind. `a` opens a quick-actions list of preset comments you pick with `j`/`k` and `⏎` (or a click), inserting the prompt as a comment on the span in one step; `x` cuts the whole block the span sits in. The list is configurable through a new `[[actions]]` config section (`prompt` plus optional `metadata`); defining any replaces the five built-in review prompts.
