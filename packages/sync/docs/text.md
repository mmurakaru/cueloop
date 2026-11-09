# Collaborative text

`@cueloop/sync/text` provides bounded plain-text documents and mergeable updates.
Each editor owns a document actor for its lifetime.
Positions use UTF-16 offsets at Unicode boundaries.

```ts
import { createSyncTextDocument } from "@cueloop/sync/text";

const document = createSyncTextDocument({
  state: acceptedState,
  canEdit: () => client.connection.state.current.name === "connected",
});
const proposal = document.replace(editedText);
const update = document.updateSince(acceptedState);

// Save the complete application operation before explicit submission.
await saveOperation({ update });
document.receive(nextAcceptedState);
document.close();
```

Create the initial shared state once with `createSyncTextState(text)`.
Other editors load that state rather than independently seeding the same string.
`mergeSyncTextUpdate` returns both the merged state and its queryable text.
Persist both with the accepted revision and operation receipt in one authority transaction.
Updates with missing causal dependencies fail validation.

> [!IMPORTANT]
> The application must authorize each update against current membership before merging it.
> A valid text update grants no access by itself.
> Rejected updates must not enter the authoritative document.

Documents allow 100,000 UTF-16 units, 4 MiB of encoded state, and 128 KiB per binary update.
Rich text, embedded objects, extra shared roots, and malformed Unicode fail validation.
Store disconnected input separately as a draft.
Reconnect does not submit it.
After reconnect, explicit submission can merge a draft against newer accepted state with `updateSince`.

`mapSyncTextPosition` maps a position between two related accepted states.
An unavailable position returns `undefined`.
Applications own selection display, revision history, and quote-anchor resolution.

## Terminal editor integration

The application can expose `openText(arguments_)`, which returns a `SyncTextEditorSession`.
Its stable snapshot reports text, shared state, connection, freshness, lifecycle, permissions, and submission outcome separately.
`change` retains local input; `save` explicitly submits it; `close` releases resources.
The application owns durable drafts and request recovery.

The experimental cueloop host renders this contract with:

```sh
cueloop sync edit --application ./application.ts --workspace <id> --record <id>
```

Enable Sync in Settings > Experimental first.
Ctrl+Enter saves and closes after acceptance.
Ctrl+Q closes with a saved local draft.
Pending and rejected requests remain visible.
The standalone CLI can submit application text operations through `connect --operation <file>` without importing terminal UI code.
