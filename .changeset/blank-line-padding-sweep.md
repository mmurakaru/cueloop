---
---

Style-only: one-off codemod sweep that adds blank-line padding across the codebase - a blank line before every `return` and after a run of declarations (closes #277). The convention is recorded in AGENTS.md; oxlint cannot enforce it yet (upstream oxc#479 for the rule, oxc#22053 for oxfmt), so it stays a documented convention until the rule lands. No shipped behavior changes: whitespace only, verified by typecheck, lint, and the full test suite (including the PTY tier).
