---
"cueloop": minor
---

Add durable harness bindings and Message delivery for Threads. The daemon and
CLI now send stable-ID Messages with `approved` or `changes_requested` outcomes,
and harness adapters can redeliver safely until native injection is acknowledged.
The TUI uses `Send message (n)`, and active code and commands use Thread and
Message names without the pre-alpha decision aliases.
