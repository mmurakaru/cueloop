---
---

CI-only: raise the global bun test timeout to 30s and route CI and the release lane through the shared `test` script. The heavy terminal-rendering tests run concurrently with the whole suite and intermittently blew the tight default per-test timeout under loaded-runner contention, false-failing the publish. No shipped behavior changes.
