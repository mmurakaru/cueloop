# Harness adapters

Cueloop owns the Thread and review lifecycle. Claude Code, Codex, and pi only
connect their session lifecycle and native messaging to it.

```text
Harness lifecycle event
        |
        v
Harness adapter
  - identify and bind the harness session
  - submit or revise the artifact
  - open cueloop threads
  - subscribe for Messages
  - send Messages through the harness
        |
        v
Shared cueloop Thread + UX core
  - canonical Thread state
  - review lifecycle
  - Message routing and durable delivery
        |
        v
Existing cueloop TUI
  - thread panel: plan, reply, prototype
  - changes panel: diff, review
```

## Controller contract

`createHarnessThreadController().openWorkflow` is the entry point for all six
workflows. Plan, reply, and prototype submit Markdown to the thread panel. Diff
submits a working-tree patch to the changes panel. Review imports a PR diff,
opens the changes panel, and posts its Message to the forge. Refine analyzes the
Thread corpus before submitting agent-drafted proposals as a plan Thread.
Review and refine are workflows, not new artifact types.

The daemon alone owns Thread state, revisions, annotations, Messages, bindings,
and deliveries. Adapters must not persist a second review model, parse their own
copy of an artifact, or render a harness-specific review UI. A new adapter
implements session identity, lifecycle interception, Thread submission through
the controller, native Message injection, and reload reconciliation. It uses
the same TUI, controller contract tests, and Message ID for duplicate
suppression. Claude Code uses the required Mod API, Codex uses plugin hooks and
MCP, and pi uses its extension API.

## Thread surface

The surface port opens the built-in panel. Terminal and multiplexer launch
implementations belong to their integrations.

`createTerminalThreadSurfacePort` selects Herdr when nested inside Ghostty and
otherwise uses Ghostty on macOS. Personal config accepts
`[integrations.herdr] thread_surface = "tab" | "pane" | "none"`; tab is the
default. Ghostty accepts `[integrations.ghostty] thread_surface = "tab" | "pane" |
"window" | "none"`, also defaulting to tab. Repository config cannot trigger
terminal automation. A pane opens on the right at 50 percent width. Native
handles live in daemon adapter scratch, not in the Thread. If opening fails,
the controller leaves the Thread pending
and returns `Open cueloop threads: cueloop <thread-id>` to the harness.

## Message delivery

The daemon persists bindings and deliveries outside the Thread. It routes a
Message to the submitting binding by default and retries an unacknowledged
delivery after restart. Once an approved Message is acknowledged, the same
plan may pass through the shared controller unchanged one time. An adapter sends
the Message through its harness API, deduplicates by Message ID with
`createDeliveredMessageStore`, then acknowledges the delivery. Native injection
uses the Message ID as an idempotency key when the harness supports one. Forge
post-back also needs a Message ID journal. A crash between an external side
effect and recording the ID can repeat it; delivery itself is at least once.
The same Thread can later route Messages to another bound harness without
changing the TUI.

## Thread agent harness prototype

The fx harness adapter (`src/fx/harness.ts`) translates ACP into the schema's `AgentHarnessAdapter` contract. The CLI supplies it to the daemon; the daemon never imports this package. Provider session IDs stay paired with their adapter ID. See [the prototype instructions](../../examples/fx-thread) for opt-in development and [the lifecycle experiment](../../examples/agent-lifecycle) for checked recovery laws. Harness-advertised model/reasoning choices and cueloop tool calls pass through the same contract; JSON tool arguments are parsed at the daemon boundary. [Submission laws](../../examples/agent-submission) check queueing, immutable accepted input, and retry behavior.

### Thread agent diagnostic routing

Harness adapters emit `AgentHarnessEvent`. `routeHarnessOutput` sends diagnostic
notices to a private bounded log at
`<cueloop-home>/thread-agents/<encoded-thread-id>.diagnostics.ndjson`, outside
Thread history and subsequent model context. Unknown diagnostic severities stay
intact. An advisory notice, including one with severity `error`, does not determine
the turn outcome; prompt results and transport failures still do.

The fx adapter advertises ACP v1 session notices and handles structured `notice`
updates. After observing a structured notice, it preserves assistant chunks
without text matching for that connection. The inspected fx 0.0.12 transport does
not supply notice provenance. `FxLegacyStartupMessages` is an isolated fallback
for its known complete startup lines, with at most 128 tracked IDs and 32 KiB per pending notice. It never classifies
an entire message ID: later HTTP errors under the same ID remain visible. Changed
or unfinished notice wording is preserved. An exact assistant quotation of a
legacy notice can still be misclassified; upstream structured provenance is
required to remove that ambiguity.

Pi consumers can import `parsePiHarnessOutput` from
`@cueloop/adapters/pi/harness-output` at their RPC or SDK boundary. It validates
frames, retains assistant text without prefix matching, separates notices and
extension errors, and distinguishes cancellation, failure, activity, and
`agent_settled`. Callers assign message identities and track turn outcomes across
retries; neither a prompt acknowledgement nor `agent_end` means the turn settled.
This provides the output normalization seam, not a new pi subprocess harness.

### Owner-hosted durable conversations

New Thread agents use the Pi Durable adapter. One Harness owns each Thread's
conversation in `<cueloop-home>/pi-conversations/<session-id>`. Models,
credentials, durable Storage, and ExecutionEnv are separate host dependencies.
The supplied environment runs on the owner machine; it is not a sandbox.
Existing fx conversations retain their adapter and session identity. Set
`CUELOOP_AGENT_HARNESS=fx` to select fx for new conversations.

The Pi adapter reads the owner's `~/.pi/agent/auth.json` credentials and the
provider's supported environment credentials. Refreshes are persisted in
cueloop's private `model-credentials.json`, leaving the imported source unchanged.
Credentials are never included in share blobs or relay frames. Provider login remains a local operation.

With `[experimental] thread_agent = true`, the share wizard offers **Allow agent
messages**, off by default. Enabled collaborators use the owner's conversation
and model account. Ctrl+Enter submits agent input; Option+Enter keeps comments
inline and editable. A disabled link still supports ordinary comment threads.

The gateway persists input before showing it queued and keeps the request until
the owner daemon acknowledges a persisted operation receipt. If the owner is
disconnected, the artifact stays readable and the Thread shows **Owner offline**.
An authenticated owner connection receives requests over `cueloop-agent` SSH,
merges their annotations into the local Thread, and streams agent state back.
Reconnect reuses operation IDs; changed payloads cannot reuse an accepted ID.
The gateway runs no model or workspace tools. Hosting execution elsewhere would
require supplying Storage, Models and an isolated ExecutionEnv on that host.
