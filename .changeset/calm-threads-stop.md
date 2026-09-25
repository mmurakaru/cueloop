---
"cueloop": patch
"@cueloop/daemon": patch
"@cueloop/adapters": patch
"@cueloop/pi": patch
---

Add `cueloop session delete <session-id>`. Deleting a Thread clears its harness bindings and deliveries for pi, Codex, and Claude Code, and daemon startup removes harness state left by older deletions.
