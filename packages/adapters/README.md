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
delivery after restart. An adapter sends the Message through its harness API,
deduplicates by Message ID, then acknowledges the delivery. The same Thread can
later route Messages to another bound harness without changing the TUI.
