import { fetchSyncWorkspaceAuthority } from "@cueloop/sync/authority/client";
import { sharedRecordMutators } from "./shared-record.ts";
import type { createSharedRecordClient } from "./client.ts";

export async function editSharedRecord(options: {
  client: ReturnType<typeof createSharedRecordClient>;
  authorityURL: string;
  auth: string;
  workspaceIdentifier: string;
  recordIdentifier: string;
  content: string;
}): Promise<void> {
  const authority = await fetchSyncWorkspaceAuthority({
    authorityURL: options.authorityURL,
    workspaceIdentifier: options.workspaceIdentifier,
    headers: { authorization: `Bearer ${options.auth}` },
  });

  if (
    authority.authorityIdentifier !== options.client.authority.authorityIdentifier ||
    authority.generation !== options.client.authority.generation
  )
    throw new Error("Sync authority changed while opening the client; reconnect before editing");

  const result = await options.client.mutate(
    sharedRecordMutators.edit({
      authority,
      id: options.recordIdentifier,
      content: options.content,
    }),
  ).server;

  if (result.type === "error")
    throw new Error(`Sync example mutation failed: ${result.error.message}`);
}
