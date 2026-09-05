---
"@cueloop/client": minor
"cueloop": minor
---

Retire the separate inbox screen. Opening the app with nothing selected lands directly in the shell - the same header and Projects/Threads sidebar as a thread view, with a disposable Welcome tab in the center that points at where to start, the docs, and what shipped in this build. Closing the Welcome tab leaves a bare select-a-thread hint, and picking a thread swaps the center for it.
