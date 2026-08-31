---
---

CI-only: raise the daemon-startup budget (`CUELOOP_START_TIMEOUT_MS`) to 60s inside the adapter round-trip e2e, matching that file's already-generous per-test timeouts. On a contended runner the daemon subprocess could miss the default 30s startup window and hard-fail inside `connect()` - one of the flake classes that false-failed the publish lane. No shipped behavior changes. Other e2e flake classes (virtual-terminal frame-render timing) remain and are tracked separately.
