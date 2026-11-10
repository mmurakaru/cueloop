# @cueloop/adapters

Connect Claude Code, Codex, and pi to cueloop Threads and review Messages.

```text
Harness lifecycle → adapter → shared Thread controller → daemon → TUI
Review Message   → daemon  → adapter → harness conversation
```

> [!IMPORTANT]
> The daemon owns Thread state, review history, bindings, and deliveries.
> Adapters use the shared controller and TUI.
> Keep harness session identity and native messaging in the adapter.

## Workflows

`createHarnessThreadController().openWorkflow` handles plan, reply, prototype, diff, review, and refine.
Plan, reply, and prototype submit Markdown.
Diff opens a working-tree patch.
Review imports a PR diff and posts its Message to the forge.
Refine analyzes the Thread corpus and submits proposals as a plan Thread.

New adapters provide session binding, lifecycle interception, submission, Message injection, and reload recovery.
Use the shared controller contract tests.
Claude Code uses the Mod API, Codex uses hooks and MCP, and pi uses its extension API.

## Open Threads

`createTerminalThreadSurfacePort` selects Herdr inside Ghostty and Ghostty elsewhere on macOS.
Configure terminal automation in personal config:

```toml
[integrations.herdr]
thread_surface = "tab" # tab, pane, none

[integrations.ghostty]
thread_surface = "tab" # tab, pane, window, none
```

Panes open on the right at half width.
Repository config cannot trigger terminal automation.
If opening fails, the Thread stays pending and the harness receives `cueloop <thread-id>` to open it manually.
Native terminal handles stay in daemon adapter scratch.

## Deliver Messages

The daemon retries unacknowledged deliveries after restart.
Adapters deduplicate with `createDeliveredMessageStore`, inject the Message, then acknowledge it.
Use the Message ID as the native idempotency key when supported.
Forge posting also needs a Message ID journal.
An acknowledged approval permits one unchanged plan pass through the controller.

> [!IMPORTANT]
> Delivery is at least once.
> A crash between an external action and recording its Message ID can repeat that action.

## Run Thread agents

Pi Durable owns new Thread conversations under `<cueloop-home>/pi-conversations/<session-id>`.
The owner supplies models, credentials, storage, and execution.
The supplied execution environment runs on the owner machine and is not a sandbox.
Set `CUELOOP_AGENT_HARNESS=fx` to select the fx ACP adapter for new conversations.
Provider session identities stay paired with their adapter identities.

The Pi adapter reads `~/.pi/agent/auth.json` and supported provider environment credentials.
Refreshes go to private `model-credentials.json`.
Credentials stay out of share blobs and relay frames.

See the [fx example](../../examples/fx-thread), [lifecycle checks](../../examples/agent-lifecycle), and [submission checks](../../examples/agent-submission).

### Execute synchronized requests

`createCueloopSyncExecutor` from `@cueloop/adapters/sync-executor` binds explicit workspace records to local Threads.
It uses durable daemon prompt identities and keeps final review Message submission with the owner.
See the [execution guide](../sync/docs/execution.md) for recovery and the experimental owner CLI.

### Recover fx processes

```toml
[experimental]
herdr_acp = true
```

Requires a user-installed `hc` 0.1.15 or later.
A private relay lets the daemon reattach to an in-flight ACP prompt after restart.
A missing or older `hc`, or `CUELOOP_HERDR_ACP=0`, uses a daemon child process.
`HC_SESSION` selects the Herdr session; the default is `cueloop`.
Cueloop does not install or update `hc`.

Removing a Thread stops its relay.
Without an attached client, finished relays exit after 60 seconds and running prompts remain available for 10 minutes.
`HERDR_ACP_IDLE_MS` and `HERDR_ACP_ABANDON_MS` configure these limits.
Finished terminals are removed, and relay transcripts use mode `0600`.

### Share agent access

With `[experimental] thread_agent = true`, the share wizard offers **Allow agent messages**, off by default.
Collaborators use the owner's conversation and model account.
Ctrl+Enter submits agent input; Option+Enter keeps comments inline and editable.

The gateway persists requests until the owner acknowledges a persisted receipt.
An offline owner leaves the artifact readable with **Owner offline** status.
The owner receives requests over `cueloop-agent` SSH and streams agent state back.
Reconnect reuses operation IDs; an accepted identity cannot carry changed arguments.
The gateway runs no models or workspace tools.

## Handle diagnostics

`routeHarnessOutput` writes diagnostic notices to private bounded files under `<cueloop-home>/thread-agents/`, outside Thread history and model context.
A notice severity does not decide the turn outcome.
Prompt results and transport failures do.

The fx adapter handles structured ACP notices.
For fx 0.0.12, `FxLegacyStartupMessages` recognizes only complete known startup lines, bounded to 128 identities and 32 KiB per pending notice.
Unrecognized text stays visible.
A quoted legacy notice can still be misclassified without upstream provenance.

`parsePiHarnessOutput` is available at `@cueloop/adapters/pi/harness-output`.
It validates frames and separates assistant text, notices, extension errors, cancellation, failure, activity, and `agent_settled`.
Callers assign Message identities and track retries.
Neither a prompt acknowledgement nor `agent_end` proves that a turn settled.
