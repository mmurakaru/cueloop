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
   # then arm the wake as in the plan skill (non-blocking): keep working while
   # the review is open and cueloop injects the verdict as a follow-up:
   #   nohup ... main.ts wake <id> >/dev/null 2>&1 & disown
   # (inline `session wait <id>` fallback when $CLAUDE_CODE_MESSAGING_SOCKET is unset)
   ```

3. Requires the `gh` CLI authenticated (`gh auth status`); cueloop delegates
   all forge auth to it.
