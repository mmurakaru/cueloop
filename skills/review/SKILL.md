---
name: review
description: Import a GitHub pull request into the cueloop changes panel. Use when the user asks to review a PR in cueloop; the resolved Message posts back as a PR review.
---

# cueloop review

Submit the PR number or URL through the harness's cueloop `review` workflow
when available. Otherwise, run `cueloop review <pr> --no-tui`, give the user
the returned Thread ID, and collect the Message with
`cueloop session wait <id> --timeout-ms 60000`. Repeat while pending, then run
`cueloop review-post <id> <pr>` once to post the resolved Message.
The shared forge integration imports its diff through the authenticated `gh`
CLI. The adapter opens the changes panel. When the reviewer sends a Message,
the native path posts it to the PR and delivers it into this conversation.

Check `gh auth status` if import or post-back fails. The CLI post command
deduplicates a successfully posted Message by ID.
