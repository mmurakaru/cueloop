---
"cueloop": minor
---

Annotations now resolve when a revision addresses them, so re-review shows only what is still open. The feedback document lists each annotation's id and teaches the agent to report what it acted on (`cueloop session submit-revision <id> --addressed <id,id>`); reported annotations are marked addressed by that revision. As an assist, a plan revision that removed an annotation's quoted text marks it addressed too ("drift"). Addressed annotations leave the rail (a dim `✓ N addressed by revision` line keeps the count), lose their document highlight, stop counting toward the pending badge and the verdict default, and stay out of the next feedback document - but they are never deleted from the session record.
