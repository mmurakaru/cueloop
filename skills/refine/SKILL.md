---
name: refine
description: Mine the corpus of past cueloop reviews into a report, then turn recurring feedback into writeback proposals. Use when the user wants to learn from past reviews, sharpen the agent from its review history, or asks to run refine.
---

# cueloop refine

The retrospective primitive. Where plan / diff / prototype / review are
forward-flow, `refine` reads the stored corpus of past reviews and turns the
feedback that keeps recurring into concrete edits that sharpen how you plan next
time. The CLI produces a deterministic Markdown report; you form the patterns and
draft the writebacks; the human approves them.

## Steps

1. Generate the report over the corpus at `~/.cueloop/sessions`:

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts refine
   ```

   It prints JSON with the report path and prunes reports past
   `cleanupPeriodDays`. `report` is the latest report; a timestamped copy is kept
   beside it. A run analyzes up to 200 sessions it has not seen before and skips
   sessions with no reviewer annotation and no verdict.

2. Read the report (the `report` path from the JSON). It gives you the corpus
   stats, every reviewer annotation grouped by kind with its session, primitive,
   verdict, and week, and the weekly volume.

3. Form the taxonomy. Group the annotations into **named patterns** - a short
   imperative label per recurring objection ("add tests", "wrong file",
   "over-scoped"). A group is a pattern only at **three or more members**; keep
   one-offs in a long-tail list and never write them back. Rank patterns by how
   often their members sit on a `request changes` or `comment` verdict - those
   cost the most reviews.

4. Draft one writeback per pattern, routed per item:
   - a repo-local lesson (a mistake tied to one repo) -> that repo's `AGENTS.md`
     or a project skill;
   - a global preference (something the human always wants) -> `~/.claude/CLAUDE.md`,
     a skill, or a `feedback`-type memory.

5. Submit the writebacks as a cueloop **plan** session for approval - do not edit
   any file directly. Write the proposals as a markdown plan (one section per
   writeback: the pattern, its evidence, the target file, the exact text to add),
   then follow the `plan` skill to open the review and wake on the verdict. Only
   after approval do you apply the approved writebacks to their targets.

## Boundary

`refine` never writes to `CLAUDE.md`, `AGENTS.md`, skills, or memory on its own.
It reports and proposes; the human curates and approves through the plan review.
The corpus stays read-only to refine.
