---
"cueloop": patch
---

Annotation and removal cards keep a transparent background when selected, so they sit flat on the transparent theme instead of painting an elevated fill. Selection now reads from the quote line taking the card's tone plus the matching document highlight. The submit-review card also drops its "N annotations · N blocking" line: the blocking count was always zero because nothing set an annotation's blocking flag, so the count and its plumbing are removed.
