# Durable operations

Import `defineSyncOperation` and `submitSyncOperation` from `@cueloop/sync/operations`.
Define JSON arguments with a Valibot schema, create the operation once, and save its complete envelope before submission.
Argument normalization must be stable when the same schema validates its output again.
Retry the saved envelope with its original identity, arguments, and deadline.

```ts
const operation = addComment.create({ workspaceIdentifier, arguments: { body } });
await saveDraft(operation);
const outcome = await submitSyncOperation({
  operation,
  submit: (request) => client.mutate(mutators.comment.add(request)),
  lookup: (request) => lookupReceipt(request),
});
```

The outcome is `pending`, `accepted`, or `rejected`.
A timeout or lost reply remains pending; the helper does not resubmit automatically.
Acceptance confirms a committed data change or intent, and says nothing about external execution progress.
An accepted reply is not a guarantee that every subscribed query has received the change.

> [!IMPORTANT]
> Apply `@cueloop/sync/migrations/001-operation-receipt.sql` to PostgreSQL 18 before accepting operations.
> Call `acceptSyncOperation` inside the same authoritative transaction as the application change, and send its receipt only after that transaction commits.

The server helper binds the identity to the verified actor and full canonical request.
Concurrent retries return one receipt; a changed request with the same identity fails explicitly.
Check current access in its `authorize` callback before receipt recovery or application writes.
Throw `SyncOperationRejection` for a durable application rejection that rolls back the operation's data changes.
Unexpected failures roll back the transaction and leave no accepted receipt.
Application callbacks must limit their effects to that transaction.

Requests expire after five minutes by default and permit a lifetime of at most 24 hours.
The authority rejects an expired request before its first application.
Receipt results remain available for 30 days by default.
Authorized `compactSyncOperationResults` calls remove expired result bytes in bounded batches while retaining request identities and final status indefinitely.
Expired results report `expired`; retrying them never applies their changes again.

## Example commands

Save a created comment envelope and use `--operation ./comment.json` to submit it or add `--operation-status` for receipt lookup.
Set `SYNC_AUTHORITY_URL` to the authenticated application authority.
These options also work through the experimental `cueloop sync connect` command.
