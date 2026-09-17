---
"cueloop": patch
---

Faster launch and navigation, and fix a freeze on stale annotations. A stale multi-block annotation no longer freezes the review while its quote is re-matched (the fuzzy search now shares one work budget across an anchor's blocks instead of spending it per block; a 160-block plan drops from ~16s to ~0.3s). The first frame paints before the terminal's theme query instead of after it (cold launch ~320ms to ~257ms). A session update that only changed annotations or status now reuses the parsed document projection instead of re-parsing the whole document.
