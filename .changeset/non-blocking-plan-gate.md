---
"cueloop": minor
---

The automatic plan-mode gate (the `ExitPlanMode` hook) is now non-blocking. Instead of freezing the turn until the reviewer decides, it opens the review, arms a detached inbox waiter, and denies the exit immediately - so the agent ends its turn and you keep chatting while the plan is open. When you submit a verdict cueloop injects it into the live session; on approval the agent presents the same plan again and is allowed through. This closes the last place plan review still blocked the agent.
