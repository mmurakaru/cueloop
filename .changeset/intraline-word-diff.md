---
"cueloop": patch
---

The diff review sheet now highlights the change within a modified line, not just the whole line: a deletion paired with its addition is word-diffed so the removed and added words keep the diff color while the unchanged part of the line dims. The plan tracked-changes view shares the same engine. Both are backed by a single whitespace-lossless word-diff (jsdiff diffWordsWithSpace), replacing the coarser home-grown LCS word diff, so quote anchors stay exact.
