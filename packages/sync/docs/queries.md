# Query guide

Applications define named queries with validated arguments and typed relationships.
Queries can filter rows, include related records, order results, and use exclusive cursors for pagination.
Use all ordering fields from the returned row in a cursor, including its identifier as a tie breaker.
Live pages change as records enter or leave their ordered range.
Separate pages do not form an immutable snapshot.

Authentication establishes identity.
Each named query and mutation enforces the application's permission policy.
Keep legacy ad hoc queries and CRUD mutations disabled.
Use replicated membership predicates in protected queries so active subscriptions respond to access changes.
Check current write permissions inside the authoritative transaction.
Do not accept the client's context as evidence of permission.

The example relates each shared record to its workspace and active memberships.
It returns at most 50 records by default and accepts page sizes from 1 to 100.
Only active members receive records; editors and owners can edit them.
Record writes lock the record, membership, and workspace so concurrent revocation and editing have an authoritative order.
Revocation removes matching results after the database change reaches the sync cache.
It cannot erase data already downloaded by a client.

## Example commands

The repository's `examples/sync-workspace` application defines an independent shared-record schema and authenticated query and mutation handlers.
Its SQL migration targets PostgreSQL 18 with UUID v7 identifiers.
Apply its numbered SQL migrations in order and provision an active `sync_workspace_member` row for the verified application identity.
The example CLI accepts `--workspace`, `--limit`, and a cursor supplied with both `--after-created-at` and `--after-identifier`.
Cursor timestamps are the numeric milliseconds returned in `createdAt`.
Add `--watch` to receive newline-delimited snapshots with record data and query freshness as the subscription changes.
The watcher keeps one pending snapshot while output is blocked and rejects snapshots larger than 8 MiB; use a smaller page when needed.
SIGINT and SIGTERM close the subscription and client.
Interrupted watches exit with status 130 for SIGINT or 143 for SIGTERM after cleanup.
The integration test starts isolated services, runs Bun, Node, browser, and experimental cueloop clients, verifies live changes and reconnect recovery, and cleans up its resources.
