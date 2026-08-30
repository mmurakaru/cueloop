---
"cueloop": patch
---

Fix the gateway leaving a collaborator's terminal in mouse-reporting mode. Quitting a shared plan now restores the terminal (disables mouse reporting, shows the cursor, leaves the alt screen) before the channel closes, so the local terminal no longer spews raw SGR mouse reports on every mouse move until `reset`. Previously the restore only ran after the channel had already closed, which dropped the bytes.
