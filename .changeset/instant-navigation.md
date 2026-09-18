---
"cueloop": patch
---

Navigating between threads is now instant, even with many projects and large reviews open. Opening a diff no longer word-diffs every line of the whole file up front - only the lines on screen - and opening or switching to a plan no longer builds every block before the first frame, just the ones in view. Under a worst-case load (several projects, large annotated plans, big diffs) the click-to-first-byte drops from about 108ms to about 21ms for a diff and from about 57ms to about 28ms for a plan.
