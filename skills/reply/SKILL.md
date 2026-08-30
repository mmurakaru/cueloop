---
name: reply
description: Submit your previous reply to cueloop for human review without blocking. Use when the user asks to review your last message/answer through cueloop, or wants to annotate what you just wrote before you act on it. The review is non-blocking - keep working while it is open and cueloop delivers the verdict as a follow-up message.
---

# cueloop reply review

Put your previous message in front of the user for line-level review. The
reviewer annotates it in the cueloop TUI - quoting exact sentences, editing the
text, and casting a verdict - and cueloop sends the feedback straight back to
you. The review is **non-blocking**: you submit, keep chatting with the user,
and cueloop wakes you with the verdict when the reviewer is done.

A reply is a markdown artifact, so it renders and behaves exactly like a plan
review: the reviewer selects text spans, comments, may edit your wording
directly, and returns an approval or a structured feedback document.

## Steps

1. Write your previous reply (the message the user wants to review) to a temp
   file as markdown. Use the message verbatim - do not summarize or rewrite it.
2. Create the session (the daemon autostarts) and note the `id` in the JSON:

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session create \
     --type reply --title "<short title>" --agent claude-code \
     --plan-path <path-to-reply> --content-file <path-to-reply>
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
   - `"allow": true` - the reviewer accepted your reply; proceed.
   - `"allow": false` - the `feedback` field is a structured document: apply
     the reply.md diff first (verbatim edits the reviewer made to your wording),
     then address every annotation, then resubmit the revised reply and re-arm
     the wake:

     ```bash
     bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session submit-revision <id> \
       --content-file <path>
     # then repeat step 4 to wake on the next verdict
     ```

   - `"status": "pending"` (inline fallback only) - the reviewer is not done;
     wait again with the same command. The verdict is never lost.

Use `/cueloop:plan` instead when the artifact is a forward-looking proposal you
have not written yet; use this skill to review a message you already produced.
