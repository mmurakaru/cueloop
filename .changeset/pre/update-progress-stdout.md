---
"cueloop": patch
---

`cueloop update` now prints its progress (current version, checking, updating, restart notice) to stdout instead of stderr, so ordinary status no longer shows up as red error text in terminals that color stderr. Genuine failures still go to stderr.
