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
