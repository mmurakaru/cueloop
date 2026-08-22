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

   To explain your changes file by file, add `--notes-file notes.json` with
   one note per changed file, in plain prose:

   ```json
   [{ "path": "src/store.ts", "body": "Persists the viewed set with the session record." }]
   ```

   Notes render in the reviewer's guided walk (an "agent note" block under
   each file card) and as cards in the review rail. They are your context,
   never reviewer feedback - they do not come back in the verdict.

2. Tell the user to review: `cueloop <id>` (they can also just run
   `cueloop diff` themselves to capture and open in one step).
3. Arm the wake, then **end your turn and keep helping the user** - do NOT sit
   on a blocking wait. cueloop injects the verdict as a follow-up message when
   the reviewer submits:

   ```bash
   if [ -n "$CLAUDE_CODE_MESSAGING_SOCKET" ]; then
     nohup bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts wake <id> \
       >/dev/null 2>&1 &
     disown 2>/dev/null || true
   else
     bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session wait <id> \
       --timeout-ms 540000
   fi
   ```

4. On denial, the feedback quotes the exact code lines with the reviewer's
   comments - fix each one, then show a fresh diff review if asked.
