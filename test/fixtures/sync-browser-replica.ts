import { createSharedRecordClient } from "../../examples/sync-workspace/client.ts";
import { sharedRecordQueries } from "../../examples/sync-workspace/shared-record.ts";

interface BrowserReplicaOptions {
  cacheURL: string;
  userID: string;
  auth: string;
  storageKey: string;
}

let primary: ReturnType<typeof createSharedRecordClient> | undefined;

export async function openBrowserReplica(options: BrowserReplicaOptions) {
  primary = createSharedRecordClient({ ...options, storage: "idb" });

  return primary.run(sharedRecordQueries.records(), { type: "complete" });
}

export async function closeBrowserReplica() {
  await primary?.close();
  primary = undefined;
}

export async function readBrowserReplica(options: BrowserReplicaOptions & { complete: boolean }) {
  const client = createSharedRecordClient({ ...options, storage: "idb" });

  try {
    const records = await client.run(sharedRecordQueries.records(), {
      type: options.complete ? "complete" : "cached",
    });

    return { records, connection: client.connection.state.current.name };
  } finally {
    await client.close();
  }
}

export async function waitForBrowserReplicaData(options: BrowserReplicaOptions) {
  const client = createSharedRecordClient({ ...options, storage: "idb" });
  const view = client.materialize(sharedRecordQueries.records());
  const populated = Promise.withResolvers<void>();
  const unsubscribe = view.addListener((records) => {
    if (records.length > 0) populated.resolve();
  });

  try {
    await populated.promise;
  } finally {
    unsubscribe();
    view.destroy();
    await client.close();
  }
}
