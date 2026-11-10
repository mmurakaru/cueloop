# Owner execution

Shared edits commit at the application authority while the owner's computer is disconnected.
Agent requests commit as durable intent and wait for the owner integration.
An acceptance receipt and an execution result are separate facts.

> [!IMPORTANT]
> Apply `@cueloop/sync/migrations/002-execution.sql` after the operation-receipt migration.
> Call `acceptSyncExecution` inside the same application transaction that commits its receipt.
> Its `authorize` and `prepare` callbacks must only read or write that transaction.
> External execution starts after commit through an owner integration.

## Recover before dispatch

Import `advanceSyncExecution` from `@cueloop/sync/execution`.
Supply a queue and an executor:

```ts
const report = await advanceSyncExecution({ queue, executor, signal });
```

The executor has a stable UUID `identifier`, `recover(claim, signal)`, and `dispatch(claim, signal)`.
Persist that UUID with the provider's recovery state and reuse it after restart.
The first claim pins the request to that recovery domain.
Another executor cannot take its unfinished work.

`recover` returns `absent`, `executing`, `completed`, `failed`, or `recovery-required`.
Only proven `absent` permits dispatch.
Dispatch must use `claim.operationIdentifier` as its durable idempotency key.
An uncertain dispatch reply returns to recovery.
Unavailable recovery produces `recovery-required` and never starts another request.

`runSyncExecutionWorker` from `@cueloop/sync/execution/worker` polls until its required abort signal stops it.
It retries temporary authority errors with a delay that increases from 250 milliseconds to five seconds.
One pending report retains its identity after an uncertain reply.
An expired lease discards that claim and returns to provider recovery.
Invalid requests and revoked access stop the worker.

> [!NOTE]
> This contract does not guarantee exactly-once external effects.
> The provider integration owns execution, process lifetime, and conversation recovery.
> Cancellation stops observation and further dispatch; it does not cancel accepted provider work.

## Claim and report

Use `claimSyncExecution` and `reportSyncExecution` from `@cueloop/sync/execution/server` inside application transactions.
Both require an authorization callback that checks the current owner role.
Claims use a 30-second authority-clock lease, a fresh lease identity, and an increasing fencing token.
Concurrent claims lock separate eligible rows.
An unfinished report becomes eligible for inspection after one second.

`waiting-owner` means intent is accepted without an execution observation.
`executing` means the integration found accepted provider work.
`completed` and `failed` are terminal observations.
`recovery-required` retains the request for inspection by the same recovery domain.
The authority rejects stale or expired claims and permits an identical report retry until a later claim.
An integration that outlives its lease must recover under a new claim before reporting.

`syncExecutionTable` from `@cueloop/sync/execution/schema` exposes application query columns.
Its public model excludes executor identities, lease identities, and fencing tokens.
Apply the same workspace and record permissions as other application queries.
Execution input and references must contain no provider credentials.

`createSyncExecutionQueue` from `@cueloop/sync/execution/http` calls the example's authenticated claim/report endpoint.
Applications can supply another transport through the `SyncExecutionQueue` interface.

## Run the standalone example

Export `syncExecutor` from a module with the executor contract and an optional `close` method.
The example imports this module without importing cueloop provider code.
Supply credentials through environment variables.

```sh
cueloop-sync owner --application ./examples/sync-workspace/authority.ts \
  --workspace "$WORKSPACE_IDENTIFIER" --executor ./owner-executor.mjs

cueloop-sync connect --application ./examples/sync-workspace/authority.ts \
  --workspace "$WORKSPACE_IDENTIFIER" --executions --watch
```

The owner command requires `SYNC_AUTHORITY_URL` and `SYNC_AUTH_TOKEN`.
It prints operation identities and execution observations as JSON Lines.
SIGINT and SIGTERM stop polling, complete executor cleanup, and exit with status 130 or 143.
Request submission uses a saved `execution.request` operation through `connect --operation ./request.json`.
Its receipt confirms acceptance; the execution query reports progress.

## Connect cueloop

`createCueloopSyncExecutor` from `@cueloop/adapters/sync-executor` takes a daemon client, a persisted executor UUID, and explicit workspace/record-to-Thread bindings.
It recovers through daemon prompt receipts, resumes accepted queued prompts, and dispatches with the original operation identity.
All Thread mutation crosses the daemon socket.
Its only action is `agent.prompt`, with `inputOnly: true`.
Collaborators cannot send the owner's final review Message through this integration.

Enable **Settings > Experimental > Multiplayer sync** to use `cueloop sync owner` and `cueloop sync connect --executions`.
Existing local Threads require explicit bindings; enabling sync does not import them.
The owner retains the existing execution integration and its credentials.
