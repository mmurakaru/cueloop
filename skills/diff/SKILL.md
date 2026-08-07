---
name: diff
description: Put the current working-tree changes in front of the user as a cueloop diff review. Use when the user asks to review your changes in cueloop, or before committing substantial agent-authored changes.
---

# cueloop diff review

Capture the working tree into a review session so the user annotates the
actual changes line by line.

## Steps

1. Create the session from the repo root:

   ```bash
   git diff HEAD > /tmp/cueloop-diff.patch
   git ls-files --others --exclude-standard | while read f; do
     git diff --no-index -- /dev/null "$f" >> /tmp/cueloop-diff.patch || true
   done
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session create \
     --type diff --title "working tree" --agent claude-code \
     --content-file /tmp/cueloop-diff.patch
   ```

2. Tell the user to review: `cueloop <id>` (they can also just run
   `cueloop diff` themselves to capture and open in one step).
3. Wait for the verdict exactly as in the plan skill
   (`session wait <id> --timeout-ms 540000`; pending means wait again).
4. On denial, the feedback quotes the exact code lines with the reviewer's
   comments - fix each one, then show a fresh diff review if asked.
