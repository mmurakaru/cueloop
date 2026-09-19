---
"cueloop": patch
---

Pin the install-vm base artifacts to the real Firecracker CI URLs and their sha256, so the clean-machine install tests can run. The rootfs is Ubuntu 22.04 (the version the CI bucket publishes for Firecracker v1.10), and `--update-pins` now records both architectures from one machine. No user-visible behavior changes.
