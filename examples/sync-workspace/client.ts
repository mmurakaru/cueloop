import { createSyncClient } from "@cueloop/sync";
import { sharedRecordMutators, sharedRecordSchema } from "./shared-record.ts";

export function createSharedRecordClient(options: {
  cacheURL: string;
  userID: string;
  auth: string;
  storageKey?: string;
}) {
  return createSyncClient({
    cacheURL: options.cacheURL,
    userID: options.userID,
    auth: options.auth,
    storageKey: options.storageKey ?? options.cacheURL,
    schema: sharedRecordSchema,
    mutators: sharedRecordMutators,
    context: { userIdentifier: options.userID },
    kvStore: "mem",
  });
}
