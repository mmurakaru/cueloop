import { createSharedRecordClient } from "./client.ts";
import { sharedRecordMutators, sharedRecordQueries } from "./shared-record.ts";

export async function verifyBrowserSync(options: {
  cacheURL: string;
  userID: string;
  auth: string;
}) {
  const client = createSharedRecordClient(options);

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
