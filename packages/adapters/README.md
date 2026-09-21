# Harness adapters

The shared Thread and UX core owns the review lifecycle. Each harness adapter
identifies its session, submits or revises an artifact, opens cueloop threads,
receives a resolved Message, and sends that Message into its native harness.

```text
Harness lifecycle event
  -> harness adapter: identify session, send Message through native API
  -> shared cueloop Thread and UX core: submit/revise artifact,
     open cueloop threads, route Message, acknowledge delivery
  -> existing cueloop TUI: thread panel for plan/reply/prototype/refine;
                           changes panel for diff/review
```

`HarnessThreadController.openWorkflow` is the adapter-facing contract for all
six workflows. Plan, reply, and prototype submit Markdown; diff submits a
working-tree patch; review imports a PR diff and posts its Message to the forge;
refine first exposes corpus analysis, then submits agent-drafted writeback
proposals as a plan Thread. Review and refine remain workflow metadata, not new
artifact types.
The surface port opens the built-in panel; terminal and multiplexer launch
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

The daemon persists bindings and deliveries outside the Thread. It routes a
Message to the submitting binding by default and retries an unacknowledged
delivery after restart. Once an approved Message is acknowledged, the same
plan may pass through the shared controller unchanged one time. An adapter sends
the Message through its harness API,
deduplicates by Message ID with `DeliveredMessageStore`, then acknowledges the delivery.
Native injection should use the Message ID as an idempotency key when the harness
supports one. Forge post-back also needs a Message ID journal. A crash between
an external side effect and recording the ID can repeat it; delivery itself is
at least once. The same Thread can later route Messages to another bound harness
without changing the TUI.
