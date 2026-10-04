# Agent Thread prototype

This draft extends the existing Thread document with a local agent conversation. Its header, panels, annotation controls, and Send message footer keep their existing behavior. It requires Bun and fx 0.0.12 on PATH and is disabled in normal launches and shared views.

```sh
bun run dev:watch
```

This enables the prototype, opens a seeded review, and stores daemon state in the checkout's ignored `.cueloop-dev` directory. Model requests use your configured fx account. Client and daemon reload on source edits; interrupted submissions expose Retry.

For a credential-free demonstration using real fx against an isolated localhost provider:

```sh
bun run examples/fx-thread/run.ts
```

Add `--live` to use your configured provider in the temporary workspace.

## Interaction

- Type a comment on artifact text, an answer, or a Changes selection. Its read-only mirror appears at the Thread end.
- Press Ctrl+Enter to invoke the harness with all pending comments and the final blank-line prompt. Empty input does nothing. Comments queued during a turn receive individual answers after their mirrors.
- Option+Enter saves an editable comment without invoking the agent.
- Accepted originals become read-only. Typing after one creates a discussion reply. Two clickable checks show View reply on hover and navigate to the mirror; failed submissions expose Retry and reuse the mirror.
- Type at the final blank line to extend the document. Activity and permission choices appear at the bottom.
- Select model and reasoning choices through the existing footer overlay menus.
- Send message (n) still returns the artifact review to its waiting main session. The embedded harness can also call `send_message`, `reply_to_comment`, and `cueloop_api`, including replying to the original Changes discussion.

Close and reopen without losing local history. Cancellation is available through `agent.cancel`; closing the client does not cancel the turn. Source launches outside `dev:watch` require `CUELOOP_AGENT_THREADS=1` on both daemon and client and a separate `CUELOOP_HOME`.

## Harness boundary

The schema owns the provider-neutral contract. The daemon owns submissions, persistence, queueing, and cueloop tools. The CLI selects an adapter; fx owns ACP, permissions, and configuration. Saved identity includes adapter and session IDs. Switching adapters requires a new Thread. A pi adapter can implement this contract; none is included here.

[Bend behavior laws](../agent-submission) cover the submission and cancellation models, with generated JavaScript compared against our TypeScript reducers. Component, socket, and PTY tests verify the surrounding integration. The real-binary tests use an isolated localhost provider without saved credentials or paid model requests.

```sh
bun run typecheck
bun run test
bun run test:pty
CUELOOP_TEST_FX="$(command -v fx)" bun test test/session/fx-thread.test.ts
```

## Prototype limits

Conversation history is local to the owner and stored separately from artifact revisions. Shared exports and returned review feedback do not include the embedded transcript. Workspace forks are not isolated workspaces. Transcript search and automatic tracking of changed diffs remain future work. This branch stays a draft prototype.
