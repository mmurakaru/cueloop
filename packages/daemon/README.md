# @cueloop/daemon

Own Thread changes, review history, harness bindings, and socket subscriptions in the local daemon.

## Integrate

Use the typed NDJSON client or the [daemon SDK](SDK.md).
The SDK covers permissions, safe retries, reconnecting subscriptions, and an optional scoped Effect service.

> [!IMPORTANT]
> Send Thread changes through the daemon.
> Integrations must not write session files directly.

## Workspace authority

An owner can explicitly import a Thread into a PostgreSQL workspace behind the experimental sync setting.
The local daemon retains a read-only projection and delivers accepted Messages to installed harness adapters.
See [workspace setup and recovery](SDK.md#workspace-authority).
