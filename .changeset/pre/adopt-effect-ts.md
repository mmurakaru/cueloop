---
"cueloop": patch
---

Adopt the Effect TypeScript library, starting at the daemon wait/wake seam. `effect` is added as a dependency and the interruptible long-poll behind `awaitResolve` and `awaitVerdict` now runs on Effect (`Effect.callback`, `Effect.raceFirst`, `Effect.repeat`) through a new `interruptible-wait` module, keeping the Promise API and socket protocol unchanged. AGENTS.md documents the read-first Effect workflow.
