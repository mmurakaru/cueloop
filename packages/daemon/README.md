# @cueloop/daemon

The local cueloop daemon owns Thread mutations, persisted review history, harness
bindings and socket subscriptions. Integrations use its typed NDJSON client.

See the [daemon SDK contract](SDK.md) for explicit capabilities, safe mutation
retries, reconnecting subscriptions and the optional scoped Effect service.
