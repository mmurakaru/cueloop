---
"cueloop": minor
---

Threads are stored per project on disk. Each thread is an append-only log under a folder keyed by the repository's identity, so your review history is organized by project and survives moving or re-cloning the repo. Existing reviews migrate automatically on first launch.
