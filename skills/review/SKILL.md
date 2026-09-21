---
name: review
description: Import a GitHub pull request into the cueloop changes panel. Use when the user asks to review a PR in cueloop; the resolved Message posts back as a PR review.
---

# cueloop review

Submit the PR number or URL through the harness's cueloop `review` workflow.
The shared forge integration imports its diff through the authenticated `gh`
CLI. The adapter opens the changes panel. When the reviewer sends a Message,
cueloop posts it to the PR and delivers it into this conversation. Give the
user the Thread ID so they can reopen it.

Check `gh auth status` if import or post-back fails. Do not post a second PR
review or implement forge post-back in this skill.
