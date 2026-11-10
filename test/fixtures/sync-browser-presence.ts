import { createSyncPresenceClient } from "@cueloop/sync/presence";

export async function inspectBrowserPresence(options: {
  authorityURL: string;
  workspaceIdentifier: string;
  auth: string;
}) {
  const client = createSyncPresenceClient(options);

  try {
    await client.refresh();

    return client.getSnapshot();
  } finally {
    await client.close();
  }
}
