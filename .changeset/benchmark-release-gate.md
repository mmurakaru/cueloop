---
"cueloop": patch
---

Release tooling only: a benchmark gate in the release workflow measures the previous published binary and the fresh one on the same runner, interleaved, and refuses to stage a release whose startup or first frame got materially slower (both a relative and an absolute threshold must be exceeded). Reviewed regressions can be accepted until a named version, renamed metrics stay comparable through an alias map, and a manual run can publish over a regression with a written reason. The comparison is attached to the GitHub release. No shipped behavior changes.
