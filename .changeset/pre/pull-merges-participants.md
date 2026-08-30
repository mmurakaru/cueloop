---
"cueloop": patch
---

Collaborator names now reach the planner on pull. Pulling a shared plan merges the participant registry (union by id) alongside the collaborator notes, so a teammate who named themselves resolves to that name in the review rail instead of a raw SSH fingerprint. A collaborator who left a note without naming themselves reads as anonymous. The daemon's `session.mergeAnnotations` verb becomes `session.mergeShared`, carrying both the notes and the identities behind them.
