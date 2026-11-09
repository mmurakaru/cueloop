# Presence

Presence reports connected collaborators, typing, and text selections.
It has no persistent store and creates no review-history entries.
The application supplies identity verification and current workspace permissions.

```ts
import { createSyncPresenceAuthority } from "@cueloop/sync/presence/server";

const presence = createSyncPresenceAuthority({
  authenticate: verifyRequestIdentity,
  authorize: readAuthorizedActors,
});

// Route POST /presence to this handler.
const response = await presence.fetch(request);
presence.close();
```

`authenticate` returns the verified actor identifier or `null`.
`authorize` receives a workspace identifier and a bounded list of actor identifiers.
It returns the identifiers that can currently access that workspace.
Read these permissions together against the authority, including deleted membership and workspace checks.
The server checks the recipient and every delivered actor.
An authenticated payload cannot supply another actor's identity.

> [!IMPORTANT]
> Route an authority's presence requests through one presence instance.
> A restart clears all activity; connected clients renew it.
> Multiple hosts must route a workspace to the same active presence owner.
> Presence is separate from durable participant identities.

## Connect a client

```ts
import { createSyncPresenceClient } from "@cueloop/sync/presence";

const presence = createSyncPresenceClient({
  authorityURL,
  workspaceIdentifier,
  auth,
});
const unsubscribe = presence.subscribe(() => {
  renderCollaborators(presence.getSnapshot());
});

presence.update({ typing: true });
presence.setEnabled(false); // Suspend activity while the application is offline.

unsubscribe();
await presence.close();
```

The client coalesces updates into one heartbeat per second by default.
Heartbeats can run between 500 ms and 5 seconds apart.
A failed request clears cached activity.
Presence expires after 15 seconds without a new heartbeat; typing expires after 3 seconds.
Duplicate or older sequences do not renew a lease or replace newer activity.
Close removes only that client connection.

The authority permits up to 100 connections per workspace, 4 per actor in a workspace, and 10,000 total.
Requests have a 4 KiB budget and a limit of 20 requests per actor per second.
Activity is never replayed from disk after reconnect.

## Share a selection

`createSyncTextPosition` and `resolveSyncTextPosition` from `@cueloop/sync/text` encode shared item identities.
A selection contains its document identifier and encoded anchor and focus positions.
For a forward range, use association `0` at its start and `-1` at its end.
Both endpoints of a caret use the same association.
Missing items return `undefined`; a deleted range must display as unavailable.
A selection against an unsent text draft can remain unavailable to other clients until its text is accepted.

The experimental editor displays collaborator activity and mapped selection ranges.
The standalone example can inspect or watch presence:

```sh
cueloop-sync connect --application ./application.ts --presence --workspace <id>
cueloop-sync connect --application ./application.ts --presence --workspace <id> --watch
```

Set `SYNC_AUTHORITY_URL` and `SYNC_AUTH_TOKEN` for the example.
Watch emits bounded JSONL snapshots and releases presence on interruption.
