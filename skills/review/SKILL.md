---
name: review
description: Pull a GitHub PR into a cueloop review session. Use when the user asks to review a pull request in cueloop; the verdict posts back to the PR as a real review.
---

# cueloop PR review

Fetch a pull request into cueloop; the user's verdict and annotations post
back to the forge as a real PR review.

## Steps

1. The one-step path is the CLI (fetches via `gh`, opens the TUI, posts the
   verdict back on submit):

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts review <pr-number-or-url>
   ```

   Tell the user to run that; it is interactive.
2. For a non-interactive flow (you wait on the verdict instead):

   ```bash
   gh pr diff <pr> > /tmp/cueloop-pr.patch
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session create \
     --type diff --title "PR <pr>" --content-file /tmp/cueloop-pr.patch
   # then: session wait <id> - same contract as the plan skill
   ```

3. Requires the `gh` CLI authenticated (`gh auth status`); cueloop delegates
   all forge auth to it.
