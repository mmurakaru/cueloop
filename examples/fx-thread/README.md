# Agent Thread prototype

This throwaway prototype gives a Thread an agent conversation beside its reviewed artifact. It requires Bun and fx 0.0.12 on PATH. It is disabled in normal launches and unavailable in shared or observer views.

Run the deterministic demo:

```sh
bun run examples/fx-thread/run.ts
```

The demo uses the real fx process with a localhost model provider, an isolated fx profile, and temporary workspace. It makes no paid requests and reads no saved account credentials. Replies are scripted to explain retry cancellation; this mode exercises the integration rather than model quality. Exit removes its temporary state.

Use your configured provider in the temporary workspace:

```sh
bun run examples/fx-thread/run.ts --live
```

That mode uses normal fx authentication and model settings. The agent runs in ask mode and presents permission choices in the Thread.

## Try the interaction

1. Ask a question and press Ctrl+Enter or Cmd+Enter.
2. Expand Tools to inspect activity and open a referenced file.
3. Select a passage in a completed answer and type a comment. Send it with Ctrl+Enter or Cmd+Enter.
4. Use Send message (n) to deliver pending comments together, with or without another question.
5. Select Artifact to read the original review. Place its caret on a passage and choose Ask about passage to include that block in a question.
6. Stop a turn, resize the terminal, or close and reopen a Thread. Transcript state belongs to the daemon; closing the client does not stop the agent.

Escape leaves the question composer. `i` returns to it while reading the transcript. Existing Thread selection and annotation controls apply to completed answers. Comments on delivered answers remain attached to their message IDs, including when another answer repeats the same text.

For ordinary source launches, explicitly set `CUELOOP_FX_THREAD=1` on both the daemon and client and use a separate `CUELOOP_HOME`. Existing daemons do not inherit changed environment variables. A daemon restart terminates its agent process; the next question loads the saved fx session ID and resumes the conversation. Interrupted turns are shown as interrupted, not completed.

## Verification

```sh
bun run typecheck
bun test packages/daemon/src/thread-agent.test.ts
bun test packages/client/src/thread/agent-transcript.test.ts packages/client/src/thread/components/AgentThreadPane.test.tsx
CUELOOP_TEST_FX="$(command -v fx)" bun test test/session/fx-thread.test.ts
CUELOOP_RUN_PTY=1 CUELOOP_TEST_FX="$(command -v fx)" bun test --timeout 60000 test/pty/fx-thread.test.ts
```

The socket test runs permissions and ownership against a reproducible ACP process. The opt-in real-binary tests use the localhost provider setup exercised by [fx's official configured-provider tests](https://github.com/vercel-labs/fx/blob/v0.0.12/tests/e2e/fixtures/chat-completions.ts). The PTY test drives the actual application, selects answer text, sends an anchored comment, resizes, reopens, and checks that feedback reaches the same session without duplicated history. Without the real-binary option, it uses the reproducible ACP fixture for CI.

## Deliberate limits

- Transcript state is stored separately from artifact revisions and is local to the owner. Shared Thread exports do not include it.
- Asking fx does not submit the existing artifact review or wake its waiting harness. Agent feedback and artifact feedback remain separate.
- The current workspace is shown explicitly. History forks do not create isolated agent workspaces.
- The transcript can be selected and annotated through the existing Thread surface. Tool locations open files; transcript search, automatic tracking of changed diffs, and explanation-to-hunk links remain future work.
- One prompt runs per Thread. Stop and the next turn are supported; mid-turn steering is not implemented.
- Messages and tool previews are bounded. At the prototype's history limit, start a new Thread. Completed file or command effects are not undone by Stop.
- This is a draft prototype, with no automatic landing or release changes.
