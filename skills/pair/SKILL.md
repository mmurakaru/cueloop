---
name: pair
description: Start a live cueloop pairing session where you work through the user's code comments.
disable-model-invocation: true
---

# cueloop pair

Start pairing in the current repository. The user stays in control of which code changes.

1. Record the pairing start time. Run `cueloop pair --no-tui` and parse the JSON `threadId`. This finds or creates the repo's live workbench Thread. Its daemon watches the checkout through the configured VCS adapter, so Git, JJ, or another configured VCS appears in the Changes editor as it changes.
2. Read the Thread and remember the current history entry IDs. Start `cueloop session events <threadId> --ready` as a long-running command and wait for its `events.ready` JSON line. The event stream subscribes before it reads the Thread. Read the Thread again after readiness and reconcile any entries added since the first read. This catches activity in the gap before subscription.
3. Open `cueloop pair <threadId>` in a terminal pane the user can interact with. In a Herdr session, split the current pane with `herdr pane split --pane "$HERDR_PANE_ID" --direction right --ratio 0.72 --cwd "$PWD" --focus`, then send that command to the returned pane with `herdr pane send-text` and `herdr pane send-keys ... enter`. Use the host's terminal pane or tab control when it is not Herdr.
4. Build a queue from human-authored annotations in history order. Track processed annotation IDs in your context. Handle one item at a time, then reconcile the Thread again before waiting for another event.
5. Decide whether each comment requests a code change or asks for an answer. Use your language judgment for this first version. For a code change, follow the instruction with the host's edit tools and leave the annotation open. For a question, reply in that annotation's discussion as author `agent`; keep the comment open. Do not add annotations about your own code edits.
6. After each event, read the Thread and reconcile history. A `message` history entry created after the pairing start time ends pairing, even when its body is empty or the Thread remains pending. Stop the event stream when this happens.
7. If `session events` exits because the daemon disconnected, restart it with `--ready`. Once ready, read the Thread and reconcile all history entries since the last read before processing more events. The command exits with an error when its connection closes, so it cannot silently leave the agent waiting.

If the user leaves several comments while you are editing, finish the current item and then work through the rest in history order. Every human comment is one backlog item, either an edit or a reply.

Use `cueloop session get <threadId>` to inspect the Thread and `cueloop session annotate <threadId> --reply-to <annotationId> --author agent --author-name "Agent" --body "..."` to answer a question. Do not mark action comments addressed. The user reviews the edits in the live Changes panel and can add another comment.
