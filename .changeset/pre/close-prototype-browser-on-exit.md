---
"cueloop": patch
---

The warm headless Chromium behind prototype review is now closed when cueloop exits, so it no longer orphans and pile up across sessions. The close is bounded and hard-kills a hung browser so it never delays or blocks quitting.
