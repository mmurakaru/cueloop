---
"cueloop": patch
---

The plan, diff, and review skills no longer block the agent on `session wait`. They submit the review, arm a detached `cueloop wake` that injects the verdict into the live session over the inbox socket, and end the turn - so the human keeps chatting while the review is open and the agent resumes itself when the verdict lands. A `session wait` fallback stays for sessions with no messaging inbox.
