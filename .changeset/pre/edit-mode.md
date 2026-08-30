---
"cueloop": patch
---

Edit mode now works for every reviewer, in any shell. The editor resolves through `[ui] editor` config, then `$CUELOOP_EDITOR`/`$VISUAL`/`$EDITOR`, then a `nano` fallback, so a clean environment can still edit a plan (it used to throw). Known GUI editors get their wait flag applied automatically (`code --wait`, `subl --new-window --wait`, `zed --wait`, ...), and any editor that returns instantly with the file untouched drops to a confirm gate on the released terminal ("save and close it, then press Enter") instead of silently discarding the edit. Terminal editors are trusted to hold the terminal and never see the gate.
