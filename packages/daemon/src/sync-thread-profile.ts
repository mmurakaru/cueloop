import { fetchSyncWorkspaceAuthority } from "@cueloop/sync/authority/client";
import { isDeepStrictEqual } from "node:util";
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
  const drafts = createSyncDraftStore({
    storage,
    authorityIdentifier: options.connection.authorityURL,
    userIdentifier: options.connection.actorIdentifier,
    maximumBytes: 64 * 1024 * 1024,
  });

  let connected:
    | {
        client: ReturnType<
          typeof createSyncClient<typeof syncThreadSchema, { actorIdentifier: string }>
        >;
        authority: Awaited<ReturnType<typeof fetchSyncWorkspaceAuthority>>;
      }
    | undefined;
  const cancellation = new AbortController();
  let closed = false;
  let pending: Promise<unknown> = Promise.resolve();
  const connect = () => {
    const result = pending.then(async () => {
      if (closed) throw new Error("Sync Thread profile is closed");

      const authority = await fetchSyncWorkspaceAuthority({
        signal: cancellation.signal,
        authorityURL: options.connection.authorityURL,
        workspaceIdentifier: options.connection.workspaceIdentifier,
        headers: { authorization: `Bearer ${options.authenticationToken}` },
      });

      if (closed) throw new Error("Sync Thread profile is closed");

      if (
        !connected ||
        !isDeepStrictEqual(connected.authority, authority) ||
        connected.client.lifecycle.current.status !== "active"
      ) {
        await connected?.client.close();
        connected = {
          authority,
          client: createSyncClient({
            authority,
            schema: syncThreadSchema,
            mutators: syncThreadMutators,
            context: { actorIdentifier: options.connection.actorIdentifier },
            cacheURL: options.connection.cacheURL,
            userID: options.connection.actorIdentifier,
            auth: options.authenticationToken,
            storageKey: profileIdentifier,
            kvStore: storage,
          }),
        };
      }

      return { ...connected, drafts, authenticationToken: options.authenticationToken };
    });

    pending = result.catch(() => {});

    return result;
  };

  return {
    connect,
    drafts,
    authenticationToken: options.authenticationToken,
    async close() {
      closed = true;
      cancellation.abort();
      await pending;
      await connected?.client.close();
      await drafts.close();
    },
  };
}

export type SyncThreadProfile = ReturnType<typeof createSyncThreadProfile>;

export type ConnectedSyncThreadProfile = Awaited<ReturnType<SyncThreadProfile["connect"]>>;
