import { createHash } from "node:crypto";
import { join } from "node:path";
import { createSyncClient } from "@cueloop/sync";
import { createSyncSqliteStorage } from "@cueloop/sync/storage";
import { createSyncDraftStore } from "@cueloop/sync/drafts";
import { syncThreadSchema } from "./sync-thread-schema";
import { syncThreadMutators } from "./sync-thread-mutators";
import type { SyncThreadConnection } from "./sync-thread-local-state";

export function createSyncThreadProfile(options: {
  home: string;
  connection: SyncThreadConnection;
  authenticationToken: string;
}) {
  const profileIdentifier = createHash("sha256")
    .update(
      JSON.stringify({
        cacheURL: options.connection.cacheURL,
        authorityURL: options.connection.authorityURL,
        actorIdentifier: options.connection.actorIdentifier,
      }),
    )
    .digest("hex");
  const storage = createSyncSqliteStorage({
    directory: join(options.home, "sync-replicas", profileIdentifier),
  });
  const client = createSyncClient({
    schema: syncThreadSchema,
    mutators: syncThreadMutators,
    context: { actorIdentifier: options.connection.actorIdentifier },
    cacheURL: options.connection.cacheURL,
    userID: options.connection.actorIdentifier,
    auth: options.authenticationToken,
    storageKey: profileIdentifier,
    kvStore: storage,
  });
  const drafts = createSyncDraftStore({
    storage,
    authorityIdentifier: options.connection.authorityURL,
    userIdentifier: options.connection.actorIdentifier,
    maximumBytes: 64 * 1024 * 1024,
  });

  return { client, drafts, authenticationToken: options.authenticationToken };
}

export type SyncThreadProfile = ReturnType<typeof createSyncThreadProfile>;
