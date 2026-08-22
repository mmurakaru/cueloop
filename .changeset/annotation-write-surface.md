---
"cueloop": minor
---

Widen the annotation surface so review-side agents write the same authored, span-anchored comment a human does. `session annotate` now takes `--author` (and `--author-name`, which registers the collaborator's display name in the participant registry) and `--action <index|name>`, which expands a shared quick-action preset into the comment body. A new `cueloop actions list` prints that vocabulary so an agent can reference a preset by name. The built-in quick actions now ship with a system-prompt sentence each. A new `cueloop:annotate` skill wraps read-plus-comment for any bring-your-own harness, documenting the quote-exact anchor contract and the annotate-only rights boundary.
