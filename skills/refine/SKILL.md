---
name: refine
description: Analyze past cueloop Threads and propose recurring feedback writebacks through a plan Thread. Use when the user asks to learn from past reviews or run refine.
---

# cueloop refine

Use the harness's cueloop `refine` workflow to analyze the stored Thread corpus.
Read its report and group annotations into named patterns. A pattern needs at
least three members; keep one-offs in a long-tail list. Rank patterns by how
often they occur on changes-requested Messages.

Draft one proposed writeback per pattern. Include its evidence, target file,
and exact text. Route repo-specific lessons to that repo's `AGENTS.md` or a
project skill; route global preferences to the appropriate global instruction
or memory. Submit the proposals as a plan Thread through the same workflow.
The adapter opens the thread panel and delivers the resolved Message.

Do not edit the targets before approval. Corpus analysis does not mutate source
Threads; only approved writebacks change instructions or memory.
