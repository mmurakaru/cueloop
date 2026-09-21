# Harness adapters

The shared Thread and UX core owns the review lifecycle. Each harness adapter
identifies its session, submits or revises an artifact, opens cueloop threads,
receives a resolved Message, and sends that Message into its native harness.

```text
Harness lifecycle event
  -> harness adapter: identity, artifact, native message injection
  -> shared cueloop Thread and UX core: bindings, delivery, acknowledgement
  -> existing cueloop TUI: thread panel for plan/reply/prototype;
                           changes panel for diff/review
```

The daemon persists bindings and deliveries outside the Thread. It routes a
Message to the submitting binding by default and retries an unacknowledged
delivery after restart. Once an approved Message is acknowledged, the same
plan may pass through the shared controller unchanged one time. An adapter sends
the Message through its harness API,
deduplicates by Message ID with `DeliveredMessageStore`, then acknowledges the delivery.
Native injection should use the Message ID as an idempotency key when the harness
supports one. A crash between native injection and recording the ID can otherwise
repeat that injection; delivery itself is at least once. The same Thread can
later route Messages to another bound harness without changing the TUI.
