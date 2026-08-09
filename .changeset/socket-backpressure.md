---
"cueloop": patch
---

Fix: frames larger than the kernel socket buffer no longer truncate mid-line. Both the daemon and the client now honor socket backpressure - a partial write keeps its unwritten tail and flushes it on drain, so sessions with several revisions stay readable instead of wedging every request after the first oversized response.
