---
"cueloop": patch
---

cueloop launches faster. The terminal background-color query that runs at startup now waits at most 100ms instead of 200ms before falling back to the dark theme, so a terminal that does not answer the query no longer stalls the launch.
