---
"cueloop": minor
---

Add the `refine` primitive: `cueloop refine` reads the corpus of past review sessions and writes a Markdown report to `~/.cueloop/reports/` (latest `report.md` plus a timestamped copy). The report gives corpus stats, reviewer annotations grouped by kind with their session/primitive/verdict/week, and weekly volume; a run analyzes up to 200 unseen sessions and skips sessions with no annotation and no verdict. The `/cueloop:refine` skill drives the agent to group the annotations into named patterns and propose writebacks (to a skill, `AGENTS.md`, `CLAUDE.md`, or memory) for human approval via a plan review. Adds a `cleanupPeriodDays` retention window (default 30) read from `[cleanup] period_days`: the daemon prunes sessions past the window on startup, and `refine` prunes old reports.
