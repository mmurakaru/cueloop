---
"cueloop": patch
---

Tooling and docs only: pull requests get a sticky benchmark comment comparing the head against its merge base on the source-only benchmarks (informational, never blocking), every push to main records a benchmark history on the bench-history branch and runs a daemon memory leak check, and the docs site gains a Performance reference page that renders that history as trend lines. No shipped behavior changes.
