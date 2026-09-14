---
"cueloop": minor
---

`cueloop diff` now opens the per-repo workbench instead of pinning a standalone diff sheet. It find-or-creates the repo's workbench thread (the same one a bare launch creates on its first comment) and opens it in the review layout - changes panel zoomed, changes tab active - so it is annotatable right away. The Changes tab renders the live working tree, so re-running `cueloop diff` after more edits shows the current diff and reuses the same thread rather than spawning a new one. The workbench thread stays a pure annotation container: a diff review still pins its captured patch, but a workbench thread reflects the live tree.
