import { createSyncDraftStore } from "@cueloop/sync/drafts";
import { createSharedRecordClient } from "./client.ts";
import { sharedRecordMutators, sharedRecordQueries } from "./shared-record.ts";

export async function verifyBrowserRead(options: {
  cacheURL: string;
  userID: string;
  auth: string;
  storageKey?: string;
  workspaceIdentifier: string;
  pageSize: number;
}) {
  const client = createSharedRecordClient({ ...options, storage: "idb" });

  try {
    return await client.run(
      sharedRecordQueries.records({
        workspaceIdentifier: options.workspaceIdentifier,
        pageSize: options.pageSize,
      }),
      { type: "complete" },
    );
  } finally {
    await client.close();
  }
}

export async function verifyBrowserSync(options: {
  cacheURL: string;
  userID: string;
  auth: string;
}) {
  const client = createSharedRecordClient({ ...options, storage: "idb" });

  try {
    const initial = await client.run(sharedRecordQueries.records(), { type: "complete" });
    const record = initial[0];

    if (!record) throw new Error("Browser sync example requires a shared record");

    const result = await client.mutate(
      sharedRecordMutators.edit({ id: record.id, content: "Written by the browser client" }),
    ).server;
    const updated = await client.run(sharedRecordQueries.records(), { type: "complete" });

    return { accepted: result.type, content: updated[0]?.content };
  } finally {
    await client.close();
  }
}

export async function verifyBrowserDraftStorage(options: {
  authorityIdentifier: string;
  userIdentifier: string;
  phase: "save" | "read";
}) {
  const drafts = createSyncDraftStore({
    storage: "idb",
    authorityIdentifier: options.authorityIdentifier,
    userIdentifier: options.userIdentifier,
  });

  try {
    if (options.phase === "save")
      await drafts.save({ content: { body: "Browser draft retained across reload" } });

    return await drafts.list();
  } finally {
    await drafts.close();
  }
}
