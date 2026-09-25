---
name: refine
description: Analyze past cueloop Threads and propose recurring feedback writebacks through a plan Thread. Use when the user asks to learn from past reviews or run refine.
---

# cueloop refine

Use the harness's cueloop `refine` workflow when available. Otherwise, run
`cueloop refine` and read the report path in its JSON output to analyze the
stored Thread corpus.
Read its report and group annotations into named patterns. A pattern needs at
least three members; keep one-offs in a long-tail list. Rank patterns by how
often they occur on changes-requested Messages.

Draft one proposed writeback per pattern. Include its evidence, target file,
and exact text. Route repo-specific lessons to that repo's `AGENTS.md` or a
project skill; route global preferences to the appropriate global instruction
or memory. Submit the proposals as a plan Thread through the same workflow,
or write them to a file and run
`cueloop session create --type plan --content-file <proposals.md>`. On the CLI
path, collect the Message with `cueloop session wait <id> --timeout-ms 60000`.

Do not edit the targets before approval. Corpus analysis does not mutate source
Threads; only approved writebacks change instructions or memory.
