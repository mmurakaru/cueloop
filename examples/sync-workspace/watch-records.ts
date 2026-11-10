import type { TypedView } from "@rocicorp/zero";
import type { sharedWorkspaceQueries } from "./shared-workspace.ts";
import { once } from "node:events";
import { createSyncQuerySubscription } from "@cueloop/sync/queries";
import type { createSharedRecordClient } from "./client.ts";
import type { sharedRecordQueries } from "./shared-record.ts";
import type { SyncClientOutcome } from "@cueloop/sync/serve";

const MAXIMUM_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export async function watchSharedRecords(
  client: ReturnType<typeof createSharedRecordClient>,
  query: ReturnType<typeof sharedRecordQueries.records>,
): Promise<SyncClientOutcome> {
  return watchSharedView(client, client.materialize(query), "records");
}

export async function watchSharedExecutions(
  client: ReturnType<typeof createSharedRecordClient>,
  query: ReturnType<typeof sharedWorkspaceQueries.executionRequests>,
): Promise<SyncClientOutcome> {
  return watchSharedView(client, client.materialize(query), "executions");
}

async function watchSharedView<Data>(
  client: ReturnType<typeof createSharedRecordClient>,
  view: TypedView<Data>,
  field: "records" | "executions",
): Promise<SyncClientOutcome> {
  const cancellation = new AbortController();
  let signal: "SIGINT" | "SIGTERM" | undefined;
  const interrupt = () => {
    signal = "SIGINT";
    cancellation.abort();
  };
  const terminate = () => {
    signal = "SIGTERM";
    cancellation.abort();
  };

  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  const subscription = createSyncQuerySubscription({
    client,
    view,
    signal: cancellation.signal,
  });

  try {
    for await (const snapshot of subscription) {
      const output =
        JSON.stringify({
          [field]: snapshot.data,
          freshness: snapshot.freshness,
          connection: snapshot.connection,
          lifecycle: snapshot.lifecycle,
        }) + "\n";

      if (Buffer.byteLength(output) > MAXIMUM_SNAPSHOT_BYTES) {
        throw new Error("Sync watch snapshot exceeds 8 MiB; reduce --limit");
      }

      if (!process.stdout.write(output)) {
        try {
          await once(process.stdout, "drain", { signal: subscription.signal });
        } catch (error) {
          if (!subscription.signal.aborted) throw error;
        }
      }
    }

    return signal ? { status: "interrupted", signal } : { status: "completed" };
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    subscription.close();
  }
}
