---
---

Raise the virtual-terminal test wait budgets (per-test timeout 30s → 60s, the
harness wait deadline to 45s, and the inline budgets on the heaviest suites) so
the render/daemon round-trips in the TUI suites stop tripping the timeout on
contended CI runners. Test-infra only; no runtime change.
