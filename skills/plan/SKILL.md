---
name: plan
description: Submit a Markdown plan to a cueloop Thread for human review. Use when the user asks to review a plan or wants a reviewed go-ahead before implementation.
---

# cueloop plan

When the harness exposes cueloop's `plan` workflow, submit the complete Markdown
plan through it. Otherwise, write the plan to a file and use the installed CLI:

```bash
cueloop session create --type plan --content-file <plan.md>
```

Read the returned Thread ID and give it to the user. On the CLI path, collect
the Message with `cueloop session wait <id> --timeout-ms 60000`; repeat while
the response says `pending`. This path does not inject a native harness message.

Keep the plan's exact wording: annotations attach to its text. When changes are
requested, apply any edited text and every annotation, then revise the same
Thread with `cueloop session submit-revision <id> --content-file <plan.md>` on
the CLI path. Proceed with implementation only after approval.
