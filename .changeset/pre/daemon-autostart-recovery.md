---
"@cueloop/daemon": patch
---

Prevent concurrent daemon startups from stealing an unpublished lock, retry cleanly after a socket closes during the handshake, and report the daemon's startup error when autostart fails.
