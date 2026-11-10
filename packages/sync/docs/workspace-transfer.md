# Workspace transfer

Move one workspace between PostgreSQL deployments with an explicit handoff.
The destination keeps its deployment identity, replica service, and other workspaces.
Presence starts again at the destination.

> [!IMPORTANT]
> Every supported writer must check the workspace fence in its committing transaction.
> Privileged SQL that bypasses the fence is outside this contract.
> Keep the source database available for fence verification during import and activation.

## Application contract

Provide a `SyncWorkspaceTransferAdapter` with a versioned identifier, an ordered table list, and `verifyImport`.
Declare each public application table and its workspace column.
The SDK includes receipt tombstones and execution observations.
It excludes deployment metadata and replica files.

```ts
import { defineSyncWorkspaceTransferAdapter } from "@cueloop/sync/transfer";

export const transferAdapter = defineSyncWorkspaceTransferAdapter({
  identifier: "my-application/workspace-v1",
  tables: [
    { table: "workspace", workspaceColumn: "id" },
    { table: "workspace_member", workspaceColumn: "workspace_identifier" },
    { table: "document", workspaceColumn: "workspace_identifier" },
  ],
  async verifyImport(transaction, workspaceIdentifier) {
    // Check application ownership and document invariants in this transaction.
  },
});
```

List all durable workspace rows, including text state, private history, memberships, and soft deletions.
Tables must have an immutable `id` column.
Source and destination columns must match.
Required migration identities and digests must match the destination ledger.
Generated columns are computed by the destination.
The archive streams PostgreSQL JSON text so numeric and timestamp precision stays in PostgreSQL.
Each encoded row is limited to 64 MiB.

## Handoff

1. Resolve the source workspace authority and the destination deployment identity.
   Call `createSyncWorkspaceTransferBinding` and save its result before prepare.
2. Call `prepareSyncWorkspaceTransfer` with that binding and a new archive directory.
   It drains committing workspace writers, saves the destination binding, and fences the source.
3. Call `importSyncWorkspaceTransfer` at the destination with the source database URL and archive.
   It imports all rows and its journal in one transaction into a fenced workspace.
4. Call `activateSyncWorkspaceTransfer` with an application `verifyReplica` callback.
   The callback must use a fresh destination client and prove that the expected imported records have reached its replica.
5. Rebind clients explicitly with destination credentials.
   Keep pending operation envelopes unchanged and look up their receipts before any further action.

The source stays fenced when a step fails.
Repeat the same operation with the same binding and archive.
`readSyncWorkspaceTransfer` reports the latest journal for the workspace.
Import and activation retries recover committed results without importing or activating twice.
A binding cannot activate on another destination.
An absent old request has an unknown recovery outcome and is not submitted automatically.

A later transfer can return to a deployment that retains the workspace's earlier source fence.
The import replaces only that fenced workspace's canonical rows in one transaction.
It rejects an active workspace or an unrelated reservation.
Nonterminal imported execution requests stay held for provider recovery.
Existing executor identifiers, lease identifiers, fencing tokens, and provider observations remain available.
Old lease reports cannot commit at the destination.

## CLI

The application module exports `transferAdapter` through `syncApplication`.
It also supplies `verifyWorkspaceReplica` for activation.
Keep database credentials in environment variables.

```sh
cueloop-sync workspace transfer prepare --database-env SOURCE_DATABASE_URL --binding handoff.json --directory workspace-backup --application ./application.ts
cueloop-sync workspace transfer import --database-env TARGET_DATABASE_URL --source-database-env SOURCE_DATABASE_URL --directory workspace-backup --application ./application.ts
cueloop-sync workspace transfer activate --database-env TARGET_DATABASE_URL --source-database-env SOURCE_DATABASE_URL --binding handoff.json --application ./application.ts
cueloop-sync workspace transfer status --database-env TARGET_DATABASE_URL --workspace <uuid>
```

## Client rebind

`rebindSyncWorkspace` copies saved drafts atomically to the destination store before it returns the verified authority and pending receipt outcomes.
The application supplies `selectDraft` to select unsent input for this workspace or record.
Submitted records must also identify the selected workspace.
It retains the source store and fails on conflicting draft identities.
The caller then saves its configuration atomically and creates a client with the returned workspace authority.
Persistent replica keys include both deployment and workspace generations.

In experimental cueloop, use the retained workspace, actor, and record identities.
The daemon verifies the destination Thread, copies drafts, saves the route transition, and archives the previous projection.
A daemon restart reads the committed route.
Copied owner messages stay held until their provider outcome is verified.

```sh
cueloop sync rebind <thread> --workspace <uuid> --record <uuid> --authority https://authority.example --cache https://cache.example --actor <subject> --token-env TARGET_AUTH_TOKEN
cueloop sync pending <thread>
```
