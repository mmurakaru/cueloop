---
---

Test-only: de-flake the TUI submit-confirm verdict-selector test (wait on the repaint instead of reading the frame synchronously) and raise the two heavy double-boot / frame-wait budgets to 30s so publish-lane runner load cannot time them out. No shipped behavior changes.
