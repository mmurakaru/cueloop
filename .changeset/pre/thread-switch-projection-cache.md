---
"cueloop": patch
---

Switching between threads is faster. A recently-viewed thread keeps its parsed projection in a small per-thread cache, so returning to it reuses the work instead of re-parsing the diff or plan. A changed file's model is parsed on first curation touch rather than for every file when a diff opens, which the virtualized diff view never needed up front. Opening a large diff is about a fifth faster at the p95 and returns to it are cheaper.
