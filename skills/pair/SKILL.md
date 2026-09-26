---
name: pair
description: Start a live cueloop pairing session where you work through the user's code comments.
disable-model-invocation: true
---

# cueloop pair

Start pairing in the current repository. The user stays in control of which code changes.

1. Run `cueloop pair --no-tui` and parse the JSON `threadId`. This finds or creates the repo's live workbench Thread. Its daemon watches the checkout through the configured VCS adapter, so Git and JJ changes appear in the Changes editor as they happen.
2. Open `cueloop pair <threadId>` in a terminal pane the user can interact with. In a Herdr session, split the current pane with `herdr pane split --pane "$HERDR_PANE_ID" --direction right --ratio 0.72 --cwd "$PWD" --focus`, then send that command to the returned pane with `herdr pane send-text` and `herdr pane send-keys ... enter`. Use the host's terminal pane or tab control when it is not Herdr.
3. Start `cueloop session events <threadId>` as a long-running command. Keep it running while you work. Read the Thread once after subscribing, then inspect it again whenever `session.updated` arrives. The event stream closes the gap between the initial read and new annotations.
4. Build a queue from human-authored annotations in history order. Track processed annotation IDs in your context. Handle one item at a time, then reconcile the Thread again before waiting for another event.
5. Decide whether each comment requests a code change or asks for an answer. Use your language judgment for this first version. For a code change, follow the instruction with the host's edit tools and leave the annotation open. For a question, reply in that annotation's discussion as author `agent`; keep the comment open. Do not add annotations about your own code edits.
6. After every event, check the Thread status. A human Message resolves the Thread and ends pairing, even when its body is empty. Stop the event stream when that happens.

If the user leaves several comments while you are editing, finish the current item and then work through the rest in history order. Every human comment is one backlog item, either an edit or a reply.

Use `cueloop session get <threadId>` to inspect the Thread and `cueloop session annotate <threadId> --reply-to <annotationId> --author agent --author-name "Agent" --body "..."` to answer a question. Do not mark action comments addressed. The user reviews the edits in the live Changes panel and can add another comment.
