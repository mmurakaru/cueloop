# @cueloop/sync

General-purpose sync for terminals.
Build typed, live application queries against an authoritative server with a headless TypeScript client.
Applications own their data model, permissions, interface, and execution integrations.

Install with `npm install @cueloop/sync@alpha` for the SDK or `npm install --global @cueloop/sync@alpha` for the CLI.
See the [installation guide](./docs/installation.md) for the optional `cs` shortcut.

## Requirements

- Bun 1.4.4 or Node 24 and later for terminal clients.
- A bundler for browser clients.
- PostgreSQL 18 or later with logical replication and a Zero cache service.

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
import { fetchSyncWorkspaceAuthority } from "@cueloop/sync/authority/client";

const authority = await fetchSyncWorkspaceAuthority({
  authorityURL,
  workspaceIdentifier,
  headers: { authorization: `Bearer ${auth}` },
});
const client = createSyncClient({
  authority,
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

const result = await client.mutate(mutators.edit({ id, content, authority })).server;

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
> Resolve the authority before opening a persistent replica.
> The authority generation scopes the cache; keep the draft namespace stable.
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

## Edit shared text

`@cueloop/sync/text` creates bounded, mergeable plain-text updates and maps positions between document states.
Applications authorize updates and commit accepted text, shared state, history, and receipts together.
Disconnected input stays a local draft until explicit submission.
See the [text guide](./docs/text.md) for the API and experimental terminal editor.

## Show collaborators

`@cueloop/sync/presence` reports live collaborators, typing, and text-aware selections.
Presence checks current workspace access, expires after missed heartbeats, and stays outside durable history.
See the [presence guide](./docs/presence.md) for the authority, client, and standalone inspection commands.

## Execute accepted intent

`@cueloop/sync/execution` separates durable request acceptance from owner execution progress.
An injectable executor recovers provider state before dispatch and retains its operation identity after uncertain replies.
See the [execution guide](./docs/execution.md) for claims, recovery, the owner CLI, and cueloop bindings.

## Host an authority

`createSyncAuthority` from `@cueloop/sync/server` accepts your schema, authority-wrapped database adapter, authentication callback, and named query and mutation handlers.
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

## Observe an authority

OpenTelemetry providers and OTLP export belong to the application.
The SDK emits bounded traces, metrics, and logs for sync, recovery, execution, storage, and queue limits.
The host exposes separate liveness and application readiness checks and drains admitted work during shutdown.
See the [telemetry guide](./docs/telemetry.md) for configuration and deployment health.

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

See [workspace transfer](docs/workspace-transfer.md) for selective handoffs and client rebinding.
