# Backup and recovery

The canonical database is PostgreSQL 18 or later.
A backup includes the configured application schemas, text state, history, identity records, and operation receipts from one consistent snapshot.
Zero replicas and server cache metadata are derived data.

> [!IMPORTANT]
> Requests accepted after the snapshot can be absent from a restored database.
> Their outcome is unknown.
> Retain their original identity and input for recovery.

## Initialize a deployment

Set the database URL in `SYNC_DATABASE_URL` through your secret store.
Install PostgreSQL client tools that support the server's major version.
Use an empty database with no application server or execution worker connected.

```sh
cueloop-sync database initialize > recovery.json
cueloop-sync database migrate --migrations ./application-migrations.json
cueloop-sync database status
```

The migration file contains ordered application-qualified identities and SQL paths.
Applied SQL and its SHA-256 digest commit together.
Reusing an identity with different SQL fails.
Migration SQL must leave transaction control to the SDK.

```json
[{ "identity": "my-application/001-schema", "path": "./migrations/001-schema.sql" }]
```

Create a `sync_workspace_authority` binding when you provision each application workspace.
Configure Zero with the `replica.appID` in `recovery.json` and an empty replica directory.
The application module's `verifyReplica(configuration)` must verify that this fresh cache serves complete application queries.
Throw if its identity or readiness cannot be verified.

```sh
cueloop-sync database activate --recovery ./recovery.json --application ./sync-application.ts
```

## Back up

```sh
cueloop-sync database backup --directory ./backups/workspace-2026-11-10
```

The destination must be new.
The command publishes `application.dump` and `manifest.json` together after archive verification.
The manifest records the logical authority, source generation, snapshot time, migration digests, and archive digest.
Files have owner-only permissions.
Database credentials stay outside the archive manifest and subprocess arguments.
The library's `createSyncBackup` accepts additional canonical schema names.

## Restore

Provision an empty offline target database and its credentials in `RESTORE_DATABASE_URL`.
Provision required roles and extensions separately.
The archive does not copy cluster-wide roles or destination grants.

```sh
cueloop-sync database restore --database-env RESTORE_DATABASE_URL --directory ./backups/workspace-2026-11-10 > restored.json
cueloop-sync database status --database-env RESTORE_DATABASE_URL
```

Restore validates the archive digest and uses one PostgreSQL restore transaction.
An interrupted restore cannot commit a partial schema.
The restored database retains its logical authority and receives a fresh generation.
It stays in `recovering` until activation succeeds.
Nonterminal execution requests stay held for provider recovery.
A new executor reporting absence cannot release them.

Fence the source with the source identity object from the backup manifest.
This drains transactions that use the authority database wrapper.

```sh
cueloop-sync database fence --database-env SYNC_DATABASE_URL --authority ./source-authority.json
```

Configure a fresh Zero app ID and empty replica directory from `restored.json`.
Apply target migrations while the target is offline.
Configure the application module for the target services.
Activate after the application can verify the fresh replica.

```sh
cueloop-sync database migrate --database-env RESTORE_DATABASE_URL --migrations ./application-migrations.json
cueloop-sync database activate --database-env RESTORE_DATABASE_URL --source-database-env SYNC_DATABASE_URL --recovery ./restored.json --application ./sync-application.ts
```

Route clients to the target after activation.
Keep the source fenced.
An unreachable source does not prove that its writers have stopped.
Activation remains blocked when the source fence cannot be verified.

> [!NOTE]
> An online logical backup defines a recovery boundary.
> It does not provide zero data loss or selective workspace transfer.
> Protect the archive as application data and use your deployment's backup retention policy.

## Client and server contract

Wrap the application's committing database with `createSyncAuthorityDatabase` from `@cueloop/sync/authority/server`.
Capture the authority identity once when the server starts.
All authoritative writes, staging uploads, execution claims, and reports must use this wrapper.
Its fence lock lasts until the transaction commits.

Resolve `fetchSyncWorkspaceAuthority` before constructing a client that can reopen persistent mutations.
Pass the descriptor as `createSyncClient({ authority, ...options })`.
The replica storage key includes the logical authority and generation.
Keep the draft store's authority namespace stable across cache replacement.

Bind the descriptor when you create a new operation.
Save the complete envelope before submission.
Do not stamp a saved operation with the target generation, refresh its deadline, or allocate a replacement identity automatically.
A restored receipt returns its original result after current authorization.
A missing old-generation receipt produces `recovery-required` with reason `unknown-after-recovery`, including for expired requests.
This outcome is not an acceptance or rejection receipt.

The experimental Thread integration resolves the generation before opening its replica.
It keeps drafts available without connecting and displays unknown outcomes as recovery required.

## Recover a native Thread projection

A changed authority generation requires an explicit owner action.
The client retains its last projection until that action completes.

```sh
cueloop sync resume <thread> --accept-recovery
```

The daemon saves the full previous projection under its private `sync-threads/<thread-hash>/recovered-projections` directory before installing the restored snapshot.
This archive can contain work accepted after the backup.
Saved drafts retain their original operation envelopes.
Restored native messages are held outside harness delivery and wait responses.
Verify the original execution outcome before you send a new request.
