---
"cueloop": patch
---

`cueloop update` no longer prints the installer's first-run logo banner or the "run cueloop to get started" hint: an in-place update replaces the binary and reports its own result, so those first-run cues are redundant. A fresh `curl | sh` install still shows both.
