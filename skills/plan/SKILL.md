---
name: plan
description: Submit a plan to cueloop for human review without blocking. Use when the user asks to review a plan through cueloop, or when you have written a plan file and want a reviewed go-ahead before implementing. The review is non-blocking - keep working while it is open and cueloop delivers the verdict as a follow-up message.
---

# cueloop plan review

Submit a plan document for human review. The reviewer annotates it in the
cueloop TUI. The review is **non-blocking**: you submit, keep chatting with the
user, and cueloop wakes you with the verdict (an approval, or structured
feedback to apply) when the reviewer is done.

## Steps

1. Write the plan as markdown (headings, paragraphs, lists). If it lives in a
   file, use that file; otherwise write it to a temp file.
2. Create the session (the daemon autostarts) and note the `id` in the JSON:

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session create \
     --type plan --title "<short title>" --agent claude-code \
     --plan-path <path-to-plan> --content-file <path-to-plan>
   ```

3. Tell the user: `review it with: cueloop <id>` (or `bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts <id>`).
4. Arm the wake, then **end your turn and keep helping the user** - do NOT sit
   on a blocking wait. When the reviewer submits, cueloop injects the verdict
   into this session as a follow-up message; act on it then (step 5).

   ```bash
   if [ -n "$CLAUDE_CODE_MESSAGING_SOCKET" ]; then
     # non-blocking: a detached waiter posts the verdict back into this session
     nohup bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts wake <id> \
       >/dev/null 2>&1 &
     disown 2>/dev/null || true
   else
     # no inbox to wake into (not a messaging-enabled session): collect inline
     bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session wait <id> \
       --timeout-ms 540000
   fi
   ```

5. Act on the verdict (delivered as a follow-up message, or printed by the
   inline fallback):
   - `"allow": true` - proceed with the plan.
   - `"allow": false` - the `feedback` field is a structured document: apply
     the plan.md diff first (verbatim), then address every annotation, then
     resubmit the revised plan and re-arm the wake:

     ```bash
     bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session submit-revision <id> \
       --content-file <path>
     # then repeat step 4 to wake on the next verdict
     ```
   - `"status": "pending"` (inline fallback only) - the reviewer is not done;
     wait again with the same command. The verdict is never lost.

Note: the plan gate also fires automatically through the plugin hook when you
use plan mode - that gate stays blocking (it must decide in-line). This skill is
the explicit, non-blocking path.
