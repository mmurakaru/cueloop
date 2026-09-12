---
"cueloop": patch
---

Clean-machine install tests that run the real installer inside a fresh Firecracker microVM, one per scenario, on hosted Linux runners with KVM. A microVM is a truly clean box, so this catches installer bugs that shared runners and containers cannot: a missing shared library, an empty PATH, an unset HOME, a daemon left running, or no network. Seven scenarios cover a clean install, an upgrade, failed-install preservation, offline operation, shell rc edits under bash, zsh, and fish, a machine with no downloader, and an unset HOME. The scenarios reuse the install-matrix contract, so a skipped assertion still fails. A nightly workflow runs them on x64 and arm64 and files a tracking issue on a red run; it never runs on pull requests, since it needs sudo and boots a VM. No user-visible behavior changes.
