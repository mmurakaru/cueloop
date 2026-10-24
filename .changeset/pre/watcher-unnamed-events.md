---
"@cueloop/daemon": patch
---

Keep hot reload working on Linux when the file watcher reports a change without a file name, instead of crashing the watcher callback.
