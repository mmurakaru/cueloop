# Application guide

General-purpose sync for terminals.

The headless TypeScript client uses typed application queries and mutations with an authoritative server.
Applications define their data model, permissions, interface, and execution integrations.
The SDK has no dependency on cueloop's Thread model or terminal renderer.

## Runtime and services

Use Bun 1.4.4 or Node 24 and later for terminal applications.
Browser applications bundle the client entry point.
The published package contains JavaScript and TypeScript declarations.
The authority uses PostgreSQL and a Zero cache service.
PostgreSQL needs logical replication enabled.
Local hosting runs the same service stack as remote hosting.

Configure this override in the consuming application's package manifest:

```json
{
  "overrides": { "tinypool": "2.2.0" }
}
```

Zero 1.11.4 includes a formatter dependency with an affected worker-pool version.
The application-level override selects the patched version; overrides inside a library do not configure its consumers.
See the [upstream advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr).

## Client

```ts
import { createSyncClient } from "@cueloop/sync";

const client = createSyncClient({
  schema,
  mutators,
  context,
  cacheURL,
  userID,
  auth,
  storageKey,
  kvStore: "mem",
});

const view = client.materialize(queries.records());
const unsubscribe = view.addListener((records, resultType) => {
  renderRecords(records, resultType);
});

const result = await client.mutate(mutators.edit({ id, content })).server;

unsubscribe();
view.destroy();
await client.close();
```

Queries, schema builders, and named mutators use the Zero TypeScript API.
Import the typed schema, relationship, query, and mutation builders from `@cueloop/sync/schema`.
The client rejects mutation submissions unless connected to the authority.
Keep disconnected edits as application drafts and let the user submit them after reconnect.
Connection status and query result freshness are separate values.
`kvStore: "mem"` is an ephemeral cache.
Use `createSyncSqliteStorage` from `@cueloop/sync/storage` for persistent Bun and Node clients, or `kvStore: "idb"` in browsers.
Use a distinct `storageKey` for each application authority.
The user identity provides a separate storage scope within that authority.

## Recovery and drafts

```ts
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { createSyncDraftStore } from "@cueloop/sync/drafts";
import { createSyncQuerySubscription } from "@cueloop/sync/queries";

const storage = createSyncSqliteStorage({ directory: "./client-state" });
const client = createSyncClient({ ...options, kvStore: storage });
const drafts = createSyncDraftStore({
  storage,
  authorityIdentifier: cacheURL,
  userIdentifier: userID,
});
const saved = await drafts.save({ content: { body } });
const snapshots = createSyncQuerySubscription({
  client,
  view: client.materialize(queries.records()),
  signal,
});

for await (const snapshot of snapshots) {
  renderRecords(snapshot.data, snapshot.freshness, snapshot.connection);
}

await drafts.close();
await client.close();
```

The replica stores data and engine replication positions in one transaction.
Reconnect uses the engine's catch-up and authorized snapshot protocols.
The application does not supply a replication cursor.
Use `client.run(query, { type: "cached" })` to wait for a previously confirmed result during offline startup.
An immediate query can be empty while local storage loads.
If the query has no saved result, `cached` waits for the authority.
Replica persistence is scheduled by the engine; a query result is not a storage acknowledgement.
Draft-store writes commit before resolving.
Browser draft stores use `storage: "idb"` with the same authority and user scope.

Save a draft, create its operation once, and call `drafts.markSubmitted` before sending it.
Store an accepted or rejected receipt with `drafts.recordReceipt`.
A rejected draft retains its input and operation.
A pending draft cannot be discarded until its receipt is recovered.
These methods never submit or retry an operation.
Draft stores default to 1,000 items and 8 MiB; a failed write preserves the previous records.
Pending records reserve space for a final status.
If a complete receipt would exceed the byte budget, the saved final record omits `receipt` while retaining the operation, input, and accepted or rejected status.
Use the authority to retrieve its full receipt when needed.

> [!IMPORTANT]
> An accepted receipt can arrive before the replica update.
> Keep the engine's optimistic edit until its authoritative update arrives; a receipt alone does not replace query data.

`client.connection` reports transport health, query `freshness` reports completeness, and `client.lifecycle` reports storage, reset, and shutdown state.
Replace a client that reports `needs-reset` or `storage-failed`, and retain its drafts.
Calling `client.close()` blocks new writes immediately and awaits replica shutdown.
Closing does not force an extra replica checkpoint; reconnect recovers changes newer than the saved position.

A query subscription owns and closes its view.
It retains one pending full snapshot and defaults to an 8 MiB byte budget.
Slow readers receive the latest snapshot.
An oversized snapshot fails the subscription; start a smaller query or increase its budget to recover.
Cancellation or client shutdown ends the subscription and aborts its `signal` for dependent output work.

## Queries and durable operations

See the [query guide](./queries.md) for authorization and pagination, and the [operation guide](./operations.md) for durable requests and receipts.

## Authority

Import `createSyncAuthority` from `@cueloop/sync/server`.
Provide the schema, authority-wrapped database adapter, authentication callback, and named query and mutation handlers.
The [recovery guide](./recovery.md) defines the transactional fence and generation checks.
The authentication callback derives the principal from verified credentials.
The authority passes that identity to the query and mutation protocols.
Application handlers enforce record permissions.

Import `serveSyncApplication` from `@cueloop/sync/serve` to host a Fetch-compatible application in Bun or Node.
It binds to loopback by default and limits request bodies.
Use a TLS endpoint for remote clients.
Configure `publicOrigin` or `--public-origin` when a reverse proxy terminates TLS.
The host does not infer a trusted origin from forwarded headers.

## CLI

```sh
cueloop-sync serve --application ./sync-application.ts --port 4849
cueloop-sync connect --application ./sync-application.ts
```

The application module exports `syncApplication` with a `fetch` handler, a client `connect` callback, and an optional `close` callback.
The CLI runs the application authority or its configured client; PostgreSQL and Zero run as separate services.
Supply credentials through environment variables.
`cueloop-sync --help` lists the available commands.

## Cueloop integration

Enable **Multiplayer sync** in **Settings > Experimental** or configure:

```toml
[experimental]
sync = true
```

The experimental `cueloop sync` command uses the same CLI and SDK contracts.
Enabling the setting does not import existing Threads or change their authority.
Local sessions operate without the sync services.

## Standalone example and verification

The repository's `examples/sync-workspace` application defines an independent shared-record schema and authenticated query and mutation handlers.
Its SQL migration targets PostgreSQL 18 with UUID v7 identifiers.
Initialize the SDK database with the [recovery procedure](./recovery.md), then apply the example SQL migrations in order.
Provision an active `sync_workspace_member` row and a `sync_workspace_authority` binding for each application workspace.
For comment operations, save a created envelope and use `--operation ./comment.json` to submit it or add `--operation-status` for receipt lookup.
Set `SYNC_AUTHORITY_URL` to the authenticated application authority for these commands.
The same options work through the experimental `cueloop sync connect` command.
The example CLI accepts `--workspace`, `--limit`, and a cursor supplied with both `--after-created-at` and `--after-identifier`.
Cursor timestamps are the numeric milliseconds returned in `createdAt`.
Add `--watch` to receive newline-delimited snapshots with record data, query freshness, connection status, and client lifecycle as the subscription changes.
The watcher keeps one pending snapshot while output is blocked and rejects snapshots larger than 8 MiB; use a smaller page when needed.
Set `SYNC_STORAGE_DIRECTORY` to retain the example terminal client replica and drafts on disk.
Use `--drafts` to inspect saved input without starting a sync connection.
SIGINT and SIGTERM close the subscription and client.
Interrupted watches exit with status 130 for SIGINT or 143 for SIGTERM after cleanup.
The integration test starts isolated services, runs Bun, Node, browser, and experimental cueloop clients, verifies live changes and reconnect recovery, and cleans up its resources.

From the repository root:

```sh
bun install
bunx playwright install chromium
bun run test:sync
```

Docker must be available for the integration test.
The test generates its own temporary credentials.
Set `CUELOOP_TEST_CHROME_EXECUTABLE` to use an existing Chrome binary.
