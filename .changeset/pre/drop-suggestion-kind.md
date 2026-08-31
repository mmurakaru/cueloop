---
"cueloop": minor
"@cueloop/schema": minor
---

Annotations collapse to a single `comment` kind. The `s` suggest keybinding is gone (the key is now unbound), and the suggestion "Replace/With" feedback rendering is removed - every annotation serializes as a comment. Working-copy edits and hunk curation already give a stronger, directly-applied way to propose a concrete change, so the suggestion kind was redundant.

BREAKING (alpha) for `@cueloop/schema`: `AnnotationKind` no longer lists `"suggestion"`. The kind set stays open (`"comment" | (string & {})`) for forward-compat with agent notes and other kinds.
