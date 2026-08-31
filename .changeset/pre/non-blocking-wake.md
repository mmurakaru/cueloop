---
"cueloop": minor
---

Non-blocking review with a per-harness wake (ADR 0008). A plan can now be submitted without freezing the agent's turn: the human keeps chatting while the plan is open, and when they return a verdict cueloop resumes the driving agent with the feedback instead of relying on the harness to re-poll a blocked tool.

- daemon: a new `awaitResolve(client, sessionId)` seam parks on one session's verdict from a session id alone (no ReviewHandle needed), so any background waiter can collect the outcome; the held connection and the pending session both keep the daemon off its idle-exit path for the whole wait.
- pi: the `request_review` tool returns immediately with the session id and a background waiter injects the verdict with `sendUserMessage(deliverAs: "followUp")` when it lands; the pending-review write gate still holds mutating tools, and session shutdown aborts any waiter still parked.
- Claude Code: a detached inbox waiter posts the verdict into the live session over `CLAUDE_CODE_MESSAGING_SOCKET` (the frame matched to Claude Code's own example), which Claude reads between tool calls or as a fresh turn when idle. The blocking ExitPlanMode gate is unchanged.
- Codex: a detached waiter queues the verdict into the running thread via `codex queue` (app-server `thread/queue/add`), which auto-submits when the thread next goes idle. Weakest of the three paths - it needs Codex under the shared app-server daemon and still wants live-codex QA.
