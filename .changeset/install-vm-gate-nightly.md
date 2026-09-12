---
"cueloop": patch
---

Disable the install-vm nightly schedule until its guest rootfs is tool-complete. The pinned Firecracker CI rootfs is a minimal boot image without curl, wget, or the scenario shells, so a full nightly run is not green yet; the workflow still runs on demand and on harness changes. No user-visible behavior changes.
