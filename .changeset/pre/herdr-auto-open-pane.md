---
"cueloop": minor
---

A review created from inside herdr now opens itself. When the Claude Code hook or `cueloop session create` starts a genuinely new review from a herdr pane, cueloop opens a fresh herdr tab, focuses it, and launches the review in it - no more copying a command out of the log by hand. A resubmit reuses the pane the original review already opened, so revisions never spam new tabs. It stays best-effort like the rest of the herdr tier: a missing or broken herdr binary is swallowed and never blocks the review, and outside herdr nothing changes.
