import type { SyncWorkspaceAuthority } from "@cueloop/sync/authority";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createSyncDraftStore } from "@cueloop/sync/drafts";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { prepareSyncThreadCommand } from "@cueloop/daemon/sync-thread-protocol";

/** Persist the interrupted save-before-submission format without running a daemon or sending changes. */
export async function createTestSyncThreadDrafts(options: {
  authority: SyncWorkspaceAuthority;
  home: string;
  threadIdentifier: string;
  expectedVersion: number;
  connection: {
    authorityURL: string;
    cacheURL: string;
    actorIdentifier: string;
    workspaceIdentifier: string;
    recordIdentifier: string;
  };
}) {
  const connection = options.connection;
  const profileIdentifier = createHash("sha256")
    .update(
      JSON.stringify({
        cacheURL: connection.cacheURL,
        authorityURL: connection.authorityURL,
        actorIdentifier: connection.actorIdentifier,
      }),
    )
    .digest("hex");
  const drafts = createSyncDraftStore({
    storage: createSyncSqliteStorage({
      directory: join(options.home, "sync-replicas", profileIdentifier),
    }),
    authorityIdentifier: connection.authorityURL,
    userIdentifier: connection.actorIdentifier,
    maximumBytes: 64 * 1024 * 1024,
  });

  try {
    const prepared = await prepareSyncThreadCommand({
      ...connection,
      authority: options.authority,
      expectedVersion: options.expectedVersion,
      command: {
        method: "session.setTitle",
        parameters: { id: options.threadIdentifier, title: "Recovered unsent title" },
      },
    });
    const retry = await drafts.save({ content: JSON.stringify(prepared) });
    const discard = await drafts.save({ content: JSON.stringify(prepared) });

    return { retryIdentifier: retry.draftIdentifier, discardIdentifier: discard.draftIdentifier };
  } finally {
    await drafts.close();
  }
}
