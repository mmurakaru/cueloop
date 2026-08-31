---
---

CI only: strip whitespace from `TAP_TOKEN` in the Homebrew tap-push step so a copy-pasted secret with a trailing newline can't malform the clone URL. No shipped package behavior changes.
