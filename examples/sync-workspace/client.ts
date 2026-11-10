import type { SyncAuthorityIdentity } from "@cueloop/sync/authority";
import { createSyncClient } from "@cueloop/sync";
import type { ZeroOptions } from "@rocicorp/zero";
import type { SharedRecordContext } from "./shared-record.ts";
import { sharedRecordSchema } from "./workspace-schema.ts";
import { sharedWorkspaceMutators } from "./shared-workspace.ts";

export function createSharedRecordClient(options: {
  authority: SyncAuthorityIdentity;
  cacheURL: string;
  userID: string;
  auth: string;
  storageKey?: string;
  storage?: ZeroOptions<typeof sharedRecordSchema, undefined, SharedRecordContext>["kvStore"];
}) {
  const client = createSyncClient({
    authority: options.authority,
    cacheURL: options.cacheURL,
    userID: options.userID,
    auth: options.auth,
    storageKey: options.storageKey ?? options.cacheURL,
    schema: sharedRecordSchema,
    mutators: sharedWorkspaceMutators,
    context: { userIdentifier: options.userID },
    kvStore: options.storage ?? "mem",
  });

  return { ...client, authority: options.authority };
}
