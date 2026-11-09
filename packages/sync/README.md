# @cueloop/sync

General-purpose sync for terminals.
Build typed, live application queries against an authoritative server with a headless TypeScript client.
Applications own their data model, permissions, interface, and execution integrations.

## Requirements

- Bun 1.4.4 or Node 24 and later for terminal clients.
- A bundler for browser clients.
- PostgreSQL with logical replication and a Zero cache service.

The package contains JavaScript and TypeScript declarations.
Local and remote hosting use the same service stack.

> [!IMPORTANT]
> Zero 1.11.4 includes an affected worker-pool dependency.
> Set this override in the consuming application; library overrides do not apply to consumers.
> See the [upstream advisory](https://github.com/advisories/GHSA-85c8-ppgw-ccpr).

```json
{
  "overrides": { "tinypool": "2.2.0" }
}
```

## Subscribe and write

Supply your application's schema, mutators, context, and connection settings:

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
const unsubscribe = view.addListener((records, freshness) => {
  renderRecords(records, freshness);
});

const result = await client.mutate(mutators.edit({ id, content })).server;

unsubscribe();
view.destroy();
await client.close();
```

Import typed schema, relationship, query, and named mutation builders from `@cueloop/sync/schema`.
Connection status and query freshness are separate.

> [!NOTE]
> Writes require a connected authority.
> Keep disconnected edits as drafts for explicit submission after reconnect.
> `kvStore: "mem"` is an ephemeral cache.
> Use a distinct `storageKey` for each application authority.
> Use `createSyncSqliteStorage` from `@cueloop/sync/storage` for persistent terminal clients, or `kvStore: "idb"` in browsers.

## Recover work

`createSyncDraftStore` from `@cueloop/sync/drafts` retains input and complete operation envelopes across restarts.
Use a SQLite storage provider in terminal clients or `storage: "idb"` in browsers.
Drafts are scoped to authority and user, default to 1,000 items and 8 MiB, and never submit automatically.

`createSyncQuerySubscription` from `@cueloop/sync/queries` keeps one pending snapshot within an 8 MiB default budget.
It reports connection status and query freshness separately and owns its view's cleanup.
`client.lifecycle` reports storage, reset, and shutdown state.

## Submit durable changes

Define and submit operations through `@cueloop/sync/operations`.
Save each complete request before submission and retry its original identity after an uncertain reply.
Accepted and rejected receipts retain recoverable input; a pending result requires receipt lookup or an explicit retry.

> [!IMPORTANT]
> Apply the published operation-receipt migration before accepting operations.
> Commit the application change and receipt in one authoritative transaction.
> Acceptance does not confirm external execution or query replication.

See the [application guide](./docs/application-guide.md) for storage and recovery, the [query guide](./docs/queries.md) for permissions and pagination, and the [operation guide](./docs/operations.md) for durable acceptance and retention.

## Host an authority

`createSyncAuthority` from `@cueloop/sync/server` accepts your schema, database adapter, authentication callback, and named query and mutation handlers.
Derive the principal from verified credentials and enforce record permissions in application handlers.

`serveSyncApplication` from `@cueloop/sync/serve` hosts a Fetch-compatible application in Bun or Node.
It binds to loopback and limits request bodies.
Use TLS for remote clients and configure `publicOrigin` behind a TLS proxy.
Forwarded headers do not establish a trusted origin.

```sh
cueloop-sync serve --application ./sync-application.ts --port 4849
cueloop-sync connect --application ./sync-application.ts
cueloop-sync --help
```

Export `syncApplication` with `fetch`, `connect`, and an optional `close` callback.
PostgreSQL and Zero run as separate services.
Supply credentials through environment variables.

## Enable in cueloop

Choose **Settings > Experimental > Multiplayer sync** or set:

```toml
[experimental]
sync = true
```

`cueloop sync` uses the same CLI and SDK contracts.
The setting does not import existing Threads or change their authority.
Local sessions work without sync services.

## Run the example checks

[The standalone example](../../examples/sync-workspace) defines a shared-record schema and authenticated handlers with PostgreSQL 18 migrations.
The integration checks cover Bun, Node, browser, and experimental cueloop clients, live changes, and reconnect recovery.

From the repository root, with Docker available:

```sh
bun install
bunx playwright install chromium
bun run test:sync
```

Tests create temporary credentials and clean up their services.
Set `CUELOOP_TEST_CHROME_EXECUTABLE` to use an installed Chrome binary.
