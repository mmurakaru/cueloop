# Daemon SDK

The SDK is a facade over the existing NDJSON socket client. It lives at
`@cueloop/daemon/sdk`; the optional Effect service is at
`@cueloop/daemon/sdk-effect`. Both use the same daemon, Thread records and harness
adapter. Importing the Promise SDK does not load Effect.

## Capabilities

`connectOwnerSdk({ home, autostart })` authenticates with the local owner token.
It exposes Thread creation, review comments, review messages and embedded agent
operations. Agent methods still require `[experimental] thread_agent = true` in
the daemon's workspace configuration. Shared collaborators cannot invoke them.

`connectReviewSdk({ home, role: "collaborator" | "agent", author })` exposes
Thread reads and review comments only. An `agent` role here means a review-side
agent, not the daemon-owned embedded harness. The daemon enforces authorization;
TypeScript narrows the available operations but does not grant authority.
The SDK brands Thread, operation and submission IDs separately. Thread reads
return branded identities; `sdk.ids.thread`, `sdk.ids.operation` and
`sdk.ids.submission` parse external strings for incremental adoption.

## Acceptance, completion and retries

`sessions.sendMessage` and `agents.prompt` require a caller-chosen `operationId`
(up to 128 characters). Persist that ID with the normalized input if a workflow
needs to resume. Receipts are scoped to a Thread and method. The same ID and
payload return the original accepted message or submission batch after a lost
response, disconnect or daemon restart. Different payloads reject with
`operation_conflict`. Submission acceptance does not imply agent completion.

Receipts commit in the same persisted record as their mutation. Each method
retains up to 128 receipts for the lifetime of the Thread; it rejects new IDs with
`operation_capacity` rather than evicting receipts and risking duplicate work.
Deleting or retaining out an old Thread removes its receipts. A missing Thread
rejects retries. Private receipt metadata is omitted from share blobs.

`agents.wait(accepted)` waits for that exact batch and returns `completed`,
`failed`, or `cancelled`. Terminal outcomes stay fixed even when a failed
submission is explicitly retried with a new operation ID. Queued or running
submissions recovered after a daemon restart become failed; they are never
silently re-executed.

There is no automatic mutation replay. A transport failure after writing has
`certainty: "unknown"`; work may already have committed. Explicitly retry the two
receipt-backed methods with the same operation ID and payload. Thread creation,
comment replies and other legacy methods have no acceptance receipts: do not
retry an ambiguous write automatically. Comments accept caller-chosen annotation
IDs for upsert semantics, which are separate from mutation acceptance receipts.

## Failures and cancellation

`DaemonClientError` carries a daemon rejection `code` (including `forbidden`,
`resolved`, `operation_conflict` and `operation_capacity`). A rejection is not a
blanket rollback guarantee: a daemon internal error can follow a commit.

`DaemonTransportError` carries `kind`: `protocol`, `connection`, `timeout` or
`cancelled`, plus `certainty`: `not_sent` or `unknown`. A malformed result rejects
its request promptly. A malformed outer frame closes the connection and rejects
all outstanding requests. Pending requests remove timers and abort listeners on
every completion or failure path.

Requests accept `{ timeoutMs, signal }`, defaulting to a 30-second local deadline.
Cancelling a request or wait stops local observation; it does not undo a mutation
or stop a harness. `agents.cancel(threadId)` explicitly requests cancellation of
the active turn and preserves partial output. It does not clear queued inputs.
Closing the owner SDK also cancels its outstanding local waits.

## Subscriptions

`subscribeThreadState` owns an observation connection, subscribes before reading,
refreshes after matching event hints and reconnects after connection loss. Every
reconnect reads authoritative state, including changes made while disconnected.
It never replays a write or treats event notifications as a durable log.

Generation and request counters prevent late reads from overwriting newer state.
Disposal removes listeners, cancels reconnect timers, aborts reads and closes the
observation connection. Protocol errors and authorization/version rejections
stop reconnection. Transient connection failures retry at the configured delay.
The Thread-agent UI uses this shared lifecycle.

## Effect and example

`CueloopSdk.ownerLayer` acquires the owner connection with `Effect.acquireRelease`.
Its operations have a typed `DaemonSdkError` channel. `threads.watch(id)` is a
scoped stream of refreshed snapshots with a one-item sliding buffer. It coalesces
state updates rather than promising delivery of every event. Effect interruption is passed
through an AbortSignal, including to completion waits. Scope finalization closes
the connection. The layer does not replace the daemon or rewrite UI state in
Effect.

With the experimental flag enabled and a harness configured, run:

```sh
bun run packages/daemon/src/examples/daemon-sdk.ts
```

The example creates and reads a Thread, submits a prompt, waits for its terminal
outcome, lists and replies to a comment, then sends approval. It creates a real
Thread and invokes the configured model. IDs are generated once per invocation;
a resumable application should save them rather than generate replacements when
retrying.

## Workspace authority

Enable `sync` in Settings > Experimental for the Thread's repository.
Local Threads use local storage until their owner explicitly imports them.

Apply the SDK operation-receipt migration and `@cueloop/daemon/migrations/001-sync-thread.sql` to PostgreSQL.
Configure Zero with the Thread authority's `/query` and `/mutate` endpoints.
Disable legacy queries and CRUD mutations in Zero.
The [`examples/sync-thread/authority.ts`](../../examples/sync-thread/authority.ts) module provides an authenticated development authority.
Its environment variables select the database, authentication tokens, and verified actor identifiers.

```sh
cueloop sync serve --application examples/sync-thread/authority.ts \
  --maximum-request-bytes 67108864

cueloop sync import <thread> --workspace <workspace-id> \
  --authority https://sync.example.com --cache https://cache.example.com \
  --actor <verified-subject> --token-env CUELOOP_SYNC_TOKEN
```

The daemon reads the token from its environment.
Set it before starting the daemon.
Credentials stay outside Thread data and routing journals.

> [!IMPORTANT]
> A durable local fence precedes import acceptance.
> Disabling experimental sync keeps imported Threads read-only.
> Missing acknowledgements require recovery through the saved operation identity.

```sh
cueloop sync resume <thread>
cueloop sync pending <thread>
cueloop sync retry <thread> <draft-id>
cueloop sync discard <thread> <draft-id>
```

Repeat `import` with the same connection to retry a durably rejected import.
Pending or accepted imports retain their original operation identity.
Command drafts retain their original input across restart.
A rejected command requires an explicit edit and a new operation identity.
Pending drafts cannot be discarded.

`createSyncThreadApplication` from `@cueloop/daemon/sync-thread-authority` accepts a configured Zero PostgreSQL database and a credential-verification callback.
Current workspace membership controls every query and transaction.
Owners can import, navigate history, manage shares, send final Messages, fork, and delete.
Editors can change text and their own comments.
Viewers can read shared documents.
Native SSH roles retain their existing capability limits through owner-mediated comment operations.

Large imports and agent revisions use private bounded staging.
Thread state, collaborator projection, metadata, and operation receipt commit together.
Collaborator queries exclude native operation receipts, share administration, and private execution recovery fields.
Text edits carry a document generation; history or agent-base changes reject edits from an old generation and retain their input for recovery.
