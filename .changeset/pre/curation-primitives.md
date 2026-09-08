---
"@cueloop/schema": patch
"@cueloop/daemon": patch
"@cueloop/client": patch
"cueloop": patch
---

Cutting a plan block, restoring it, rejecting diff hunks, and marking files as viewed are daemon primitives. The TUI routes every one of them through the daemon, so an agent or a script can shape the artifact the same way a reviewer does: `cueloop session cut`, `restore`, `curate`, and `set-viewed`. Reject decisions live on the session, and each change appends a reviewer revision to the history.
