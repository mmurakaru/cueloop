import { once } from "node:events";
import type { createSharedRecordClient } from "./client.ts";
import type { sharedRecordQueries } from "./shared-record.ts";
import type { SyncClientOutcome } from "@cueloop/sync/serve";

const MAXIMUM_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export async function watchSharedRecords(
  client: ReturnType<typeof createSharedRecordClient>,
  query: ReturnType<typeof sharedRecordQueries.records>,
): Promise<SyncClientOutcome> {
  const view = client.materialize(query);
  const cancellation = new AbortController();
  let changed = Promise.withResolvers<void>();
  let pending: string | undefined;
  let stopped = false;
  let signal: "SIGINT" | "SIGTERM" | undefined;
  let failure: Error | undefined;
  let unsubscribe: (() => void) | undefined;
  const stop = () => {
    stopped = true;
    cancellation.abort();
    changed.resolve();
  };

  const interrupt = () => {
    signal = "SIGINT";
    stop();
  };
  const terminate = () => {
    signal = "SIGTERM";
    stop();
  };

  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);

  try {
    unsubscribe = view.addListener((records, freshness, error) => {
      if (freshness === "error") {
        failure = new Error(`Sync watch query failed: ${error?.message ?? "Unknown query error"}`);
        stop();

        return;
      }

      const snapshot = JSON.stringify({ records, freshness }) + "\n";

      if (Buffer.byteLength(snapshot) > MAXIMUM_SNAPSHOT_BYTES) {
        failure = new Error("Sync watch snapshot exceeds 8 MiB; reduce --limit");
        stop();

        return;
      }

      pending = snapshot;
      changed.resolve();
    });

    while (!stopped) {
      if (pending === undefined) {
        await changed.promise;
        changed = Promise.withResolvers<void>();
        continue;
      }

      const snapshot = pending;

      pending = undefined;

      if (!process.stdout.write(snapshot)) {
        try {
          await once(process.stdout, "drain", { signal: cancellation.signal });
        } catch (error) {
          if (!stopped) throw error;
        }
      }
    }

    if (failure) throw failure;

    return signal ? { status: "interrupted", signal } : { status: "completed" };
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    cancellation.abort();
    unsubscribe?.();
    view.destroy();
  }
}
