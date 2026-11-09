import { createSyncClient } from "@cueloop/sync";
import { sharedRecordMutators, sharedRecordQueries, sharedRecordSchema } from "./shared-record.ts";

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
    storageKey: options.storageKey,
    schema: sharedRecordSchema,
    mutators: sharedRecordMutators,
    context: { canEdit: true },
    kvStore: "mem",
  });
}

export async function connectSharedRecord(arguments_: string[]): Promise<void> {
  const cacheURL = process.env.SYNC_CACHE_URL;
  const userID = process.env.SYNC_USER_ID;
  const auth = process.env.SYNC_AUTH_TOKEN;

  if (!cacheURL || !userID || !auth) {
    throw new Error("Sync client requires SYNC_CACHE_URL, SYNC_USER_ID, and SYNC_AUTH_TOKEN");
  }

  const client = createSharedRecordClient({ cacheURL, userID, auth });

  try {
    const records = await client.run(sharedRecordQueries.records(), { type: "complete" });
    const editIndex = arguments_.indexOf("--content");

    if (editIndex >= 0) {
      const content = arguments_[editIndex + 1];
      const record = records[0];

      if (content === undefined || !record)
        throw new Error("Sync example edit requires a record and content");

      const result = await client.mutate(sharedRecordMutators.edit({ id: record.id, content }))
        .server;

      if (result.type === "error")
        throw new Error(`Sync example mutation failed: ${result.error.message}`);
    }

    process.stdout.write(
      JSON.stringify(await client.run(sharedRecordQueries.records(), { type: "complete" })) + "\n",
    );
  } finally {
    await client.close();
  }
}
