---
"cueloop": patch
---

Test-only: the PTY tier now drives the real TUI through a shared harness that feeds pseudo-terminal output into the in-repo Ghostty VT emulator, so tests press named keys and assert on the rendered screen grid instead of stripped raw bytes. Wait helpers carry the last screen in every timeout error and never re-send a dropped key. No shipped behavior changes.
