---
"cueloop": patch
---

The app fires a ready signal once, after the first frame that paints a usable screen with its keyboard handlers subscribed: an `onReady` callback for in-process tests and, when `CUELOOP_READY_FILE` names a file, that file for subprocess tests. Every App suite and the PTY tier boot on it instead of probing keys or reading output silence. CI runs the test suite once instead of retrying it three times; the retry had not fired in the last 18 green runs. No user-visible behavior changes.
