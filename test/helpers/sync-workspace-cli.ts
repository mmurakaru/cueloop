import * as v from "valibot";
import { SyncWorkspaceAuthoritySchema } from "@cueloop/sync/authority";
import {
  SyncTransferManifestSchema,
  SyncTransferJournalSchema,
  SyncTransferBindingSchema,
} from "@cueloop/sync/transfer";

const TestSyncWorkspaceCliResultSchema = v.union([
  v.object({
    status: v.literal("fenced"),
    directory: v.string(),
    manifest: SyncTransferManifestSchema,
  }),
  v.object({
    status: v.picklist(["imported", "active"]),
    authority: SyncWorkspaceAuthoritySchema,
    transferIdentifier: SyncTransferBindingSchema.entries.transferIdentifier,
  }),
  SyncTransferJournalSchema,
  v.object({ status: v.literal("unreserved") }),
]);

import { expect } from "bun:test";

export async function runTestSyncWorkspaceCli(
  arguments_: string[],
  environment: Record<string, string | undefined>,
) {
  const child = Bun.spawn(
    [process.execPath, "packages/sync/bin/cueloop-sync.js", "workspace", "transfer", ...arguments_],
    {
      env: { ...process.env, ...environment },
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(30000),
    },
  );
  const [output, error, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(status, error).toBe(0);

  return v.parse(TestSyncWorkspaceCliResultSchema, JSON.parse(output));
}

export async function createTestSyncTransferApplication(directory: string) {
  const { writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const path = join(directory, "transfer-application.mjs");
  const client = new URL("../../examples/sync-workspace/client.ts", import.meta.url).href;
  const queries = new URL("../../examples/sync-workspace/shared-record.ts", import.meta.url).href;
  const adapter = new URL("../../examples/sync-workspace/workspace-transfer.ts", import.meta.url)
    .href;
  const subscriptions = import.meta.resolve("@cueloop/sync/queries");

  await writeFile(
    path,
    `
import {createSharedRecordClient} from ${JSON.stringify(client)};
import {sharedRecordQueries} from ${JSON.stringify(queries)};
import {sharedWorkspaceTransferAdapter} from ${JSON.stringify(adapter)};
import {createSyncQuerySubscription} from ${JSON.stringify(subscriptions)};
export const syncApplication = {
  fetch: async () => new Response("Not found", {status: 404}),
  transferAdapter: sharedWorkspaceTransferAdapter,
  verifyWorkspaceReplica: async (authority) => {
    const client = createSharedRecordClient({authority, cacheURL: process.env.SYNC_CACHE_URL, userID: process.env.SYNC_USER_ID, auth: process.env.SYNC_AUTH_TOKEN});
    const snapshots = createSyncQuerySubscription({client, view: client.materialize(sharedRecordQueries.records()), signal: AbortSignal.timeout(20000)});
    try {
      for await (const snapshot of snapshots) {
        if (snapshot.freshness === "complete" && snapshot.connection === "connected" && snapshot.data.some((row) => row.id === process.env.SYNC_EXPECTED_RECORD && row.content === process.env.SYNC_EXPECTED_CONTENT)) return;
      }
      throw new Error("Imported workspace did not reach its replica");
    } finally {
      snapshots.close();
      await client.close();
    }
  },
};
`,
    { mode: 0o600 },
  );

  return path;
}
