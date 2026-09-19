---
"cueloop": patch
---

Switching back to a hot-reloading diff thread now shows the daemon's latest content instead of the stale sidebar copy. The sidebar list trails a live diff on purpose, so returning to a thread revalidates it against the daemon after the instant paint; a rapid switch never lets a late response overwrite the thread now on screen.
