---
"cueloop": minor
---

Add an opt-in herdr-core backend for fx ACP tasks. With `[experimental] herdr_acp = true` and a user-installed `hc` 0.1.15 or newer, the agent process stays up across a daemon restart and the in-flight prompt can be reattached. The flag defaults off, and a missing `hc` keeps today's child process.
