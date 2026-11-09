# @cueloop/sync

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
The client rejects mutation submissions unless connected to the authority.
Keep disconnected edits as application drafts and let the user submit them after reconnect.
Connection status and query result freshness are separate values.
`kvStore: "mem"` is an ephemeral cache; persistence requires an explicit supported storage provider.

## Authority

Import `createSyncAuthority` from `@cueloop/sync/server`.
Provide the schema, database adapter, authentication callback, and named query and mutation handlers.
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
