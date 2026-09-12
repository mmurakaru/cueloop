---
"cueloop": patch
---

Tooling only: a benchmark suite under `benchmarks/` measures binary startup, plan and diff parsing, daemon round trips, the TUI's first frame in a real pseudo terminal, key press latency, and memory, with a sampler that runs each script as a cold process and reports median and p95 as JSON. `bun run bench`. No shipped behavior changes.
