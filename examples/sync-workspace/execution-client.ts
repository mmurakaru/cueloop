import type { SyncClientOutcome } from "@cueloop/sync/serve";
import type { createSharedRecordClient } from "./client.ts";
import { sharedWorkspaceQueries } from "./shared-workspace.ts";
import { watchSharedExecutions } from "./watch-records.ts";

export async function inspectSharedExecutions(options: {
  client: ReturnType<typeof createSharedRecordClient>;
  workspaceIdentifier: string | undefined;
  pageSize: number;
  watch: boolean;
  hasOtherCommand: boolean;
}): Promise<void | SyncClientOutcome> {
  if (!options.workspaceIdentifier || options.hasOtherCommand)
    throw new Error("Sync execution inspection requires a read-only --workspace query");

  const query = sharedWorkspaceQueries.executionRequests({
    workspaceIdentifier: options.workspaceIdentifier,
    pageSize: options.pageSize,
  });

  if (options.watch) return watchSharedExecutions(options.client, query);

  process.stdout.write(
    `${JSON.stringify(await options.client.run(query, { type: "complete" }))}\n`,
  );
}
