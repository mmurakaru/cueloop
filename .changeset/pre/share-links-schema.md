---
"cueloop": patch
---

A thread can hold several share links: the schema gains a shares[] collection (each an independent link with its own id, name, and auth), and a legacy single share migrates into a one-element list on read.
