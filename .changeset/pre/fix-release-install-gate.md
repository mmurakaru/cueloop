---
---

Fix the release install-gate: the staged draft is untagged until publish, so `gh release download <tag>` 404s against it. The gate now serves the current version's binaries from this run's build artifacts (the same bytes the draft holds), unblocking publish. CI-only; no package change.
