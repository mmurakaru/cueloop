---
"cueloop": patch
---

One shared review core in @cueloop/daemon: openReview resolves the workspace, derives the title from the plan's first heading, and opens-or-revises by agent session id; ReviewHandle.awaitVerdict covers both the single long-poll and the chunked poll loop with progress and abort. The Claude Code hook, the pi extension, and the CLI commands (diff, review, session) now share this one path instead of five hand-built copies; workspace resolution has a single implementation, annotation ids come from one collision-safe helper in @cueloop/schema, and the adapter docs no longer claim a codex adapter that does not exist yet.
