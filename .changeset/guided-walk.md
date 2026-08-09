---
"cueloop": minor
---

Guided walk for diff reviews: press w in a diff session to step through every
changed file as a focused card wizard with a plain step count. ] advances and
marks the file viewed (persisted with the session, so a resumed review keeps
its progress), [ steps back, esc leaves keeping progress, and the end card
offers Submit review directly. Submitting agents can attach per-file notes
(annotations with kind "note" anchored by the file path) that render in the
wizard's agent-note block and as rail cards; notes are agent context and never
come back as reviewer feedback. The submit confirm shows the honest viewed
count for walked diff sessions.
