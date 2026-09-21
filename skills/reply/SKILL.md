---
name: reply
description: Submit the previous reply to a cueloop Thread for human review. Use when the user asks to annotate or revise your last message.
---

# cueloop reply

Submit your previous reply verbatim as Markdown through the harness's cueloop
`reply` workflow when available. Otherwise, write it to a file and run
`cueloop session create --type reply --content-file <reply.md>`. Give the user
the returned Thread ID. On the CLI path, collect the Message with
`cueloop session wait <id> --timeout-ms 60000`, repeating while pending.

If changes are requested, apply the edited wording and each annotation before
resubmitting the reply to the same Thread. On the CLI path, use
`cueloop session submit-revision <id> --content-file <reply.md>`. Use `plan` for a proposal
that has not yet been presented as a reply.
