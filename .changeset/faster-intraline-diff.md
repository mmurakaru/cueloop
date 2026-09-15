---
"cueloop": patch
---

The diff view opens changed files faster. Its intra-line word-diff cached the per-line word set instead of recomputing it for every comparison in the line-matching grid, cutting the work of rendering a multi-line change block.
