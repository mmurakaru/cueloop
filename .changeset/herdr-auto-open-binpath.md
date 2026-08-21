---
"cueloop": patch
---

Fix herdr tab auto-open: a review created inside a herdr pane now opens a new tab rendering it, as intended. `detectHerdr` required `HERDR_BIN_PATH`, which herdr 0.8+ does not set - it exposes `HERDR_SOCKET_PATH` and the `herdr` CLI on PATH - so detection silently failed and the auto-open (and agent-state reporting) no-op'd. `detectHerdr` now needs only `HERDR_ENV=1` + `HERDR_PANE_ID` and defaults the binary to `herdr` on PATH; an explicit `HERDR_BIN_PATH` still wins.
