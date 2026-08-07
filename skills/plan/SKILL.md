---
name: plan
description: Submit a plan to cueloop for human review and block on the verdict. Use when the user asks to review a plan through cueloop, or when you have written a plan file and want a reviewed go-ahead before implementing.
---

# cueloop plan review

Submit a plan document for human review. The reviewer annotates it in the
cueloop TUI; you receive either approval or structured feedback to apply.

## Steps

1. Write the plan as markdown (headings, paragraphs, lists). If it lives in a
   file, use that file; otherwise write it to a temp file.
2. Create the session (the daemon autostarts):

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session create \
     --type plan --title "<short title>" --agent claude-code \
     --plan-path <path-to-plan> --content-file <path-to-plan>
   ```

   Note the `id` in the JSON output.
3. Tell the user: `review it with: cueloop <id>` (or `bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts <id>`).
4. Wait for the verdict:

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session wait <id> --timeout-ms 540000
   ```

5. Act on the result:
   - `"allow": true` - proceed with the plan.
   - `"allow": false` - the `feedback` field is a structured document: apply
     the plan.md diff first (verbatim), then address every annotation, then
     resubmit the revised plan with
     `session submit-revision <id> --content-file <path>` and wait again.
   - `"status": "pending"` - the reviewer is not done; wait again with the
     same command. The verdict is never lost.

Note: the plan gate also fires automatically through the plugin hook when you
use plan mode - this skill is for explicit, on-demand reviews.
