---
"cueloop": patch
---

Make the end-to-end suite deadline-based instead of iteration-based, so a cold CI runner paying for a subprocess and daemon start is not mistaken for a failure.
