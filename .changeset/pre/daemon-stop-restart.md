---
"cueloop": minor
---

Added `cueloop stop` and `cueloop restart` to control the local daemon, and `cueloop update` now stops the running daemon after installing a newer build. The daemon refuses cross-version connections, so a client left talking to a stale daemon fails with "not connected" when it tries to comment; self-healing on update, plus an explicit `restart`, clears that without a manual process kill. `stop` prefers the owner-gated shutdown request and falls back to signalling the daemon's pid when a version-mismatched daemon refuses the handshake.
