---
"cueloop": minor
---

Pull collaborator notes on a shared plan back to the planner. When you share a plan, cueloop now records the share id on the session; `cueloop share pull [session-id]` (and opening a shared plan in the TUI) fetches the share's current notes and unions them into your local plan by id, so teammates' comments show up without losing your own. The gateway lets only the fingerprint that created the share pull it back.
