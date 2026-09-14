---
"cueloop": patch
---

`cueloop update` and the curl installer now resolve the right release when the GitHub releases API is returned as minified (single-line) JSON, as some corporate proxies do. `resolve_tag` matched the CLI's own `cueloop@` tags but then extracted the version with a greedy `sed`, which on single-line JSON skipped past every tag to the oldest scoped package tag on the page (`@cueloop/schema@...`) and 404ed on its missing binary. It now takes the first matching CLI tag regardless of whitespace, so the newest `cueloop@` release is chosen either way.
