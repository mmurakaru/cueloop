---
name: prototype
description: Submit an HTML prototype to cueloop for human review without blocking. Use when the user asks to review a rendered UI prototype (a design-system page, a component mockup) through cueloop, or when you have written an HTML file and want visual feedback on specific elements before implementing. The reviewer selects DOM elements in the rendered page and comments on them. The review is non-blocking - keep working while it is open and cueloop delivers the verdict as a follow-up message.
---

# cueloop prototype review

Submit a self-contained HTML file for human review. cueloop renders it with
headless Chromium and shows it as an image in the terminal; the reviewer clicks
an element (a card, a button) and comments on it. The review is
**non-blocking**: you submit, keep chatting with the user, and cueloop wakes you
with the verdict when the reviewer is done.

## Steps

1. Write the prototype as a single self-contained HTML file (inline or linked
   CSS resolved relative to the file). Absolute local asset paths work; the file
   is loaded over `file://`.
2. Create the session (the daemon autostarts) and note the `id` in the JSON:

   ```bash
   bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session create \
     --type prototype --title "<short title>" --agent claude-code \
     --prototype-path <abs-path-to-html> --content-file <abs-path-to-html>
   ```

3. Tell the user: `review it with: cueloop <id>` (or `cueloop prototype <path-to-html>`).
4. Arm the wake, then **end your turn and keep helping the user** - do NOT sit
   on a blocking wait. When the reviewer submits, cueloop injects the verdict
   into this session as a follow-up message; act on it then (step 5).

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

5. Act on the verdict (delivered as a follow-up message, or printed by the
   inline fallback):
   - `"allow": true` - proceed with the prototype.
   - `"allow": false` - the `feedback` field lists each annotation with the
     element it targets (a CSS selector) and the reviewer's comment. Apply every
     comment to the HTML, then resubmit and re-arm the wake:

     ```bash
     bun run ${CLAUDE_PLUGIN_ROOT}/packages/cli/src/main.ts session submit-revision <id> \
       --content-file <abs-path-to-html>
     ```

   - `"status": "pending"` (inline fallback only) - the reviewer is not done;
     wait again with the same command. The verdict is never lost.

Prototype review needs a graphics-capable terminal (kitty or ghostty) and an
installed Google Chrome on the reviewer's machine.
