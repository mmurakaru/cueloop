import { once } from "node:events";
import { createSyncPresenceClient } from "@cueloop/sync/presence";
import type { SyncClientOutcome } from "@cueloop/sync/serve";

export async function connectSharedPresence(options: {
  workspaceIdentifier: string | undefined;
  authorityURL: string | undefined;
  auth: string | undefined;
  watch: boolean;
}): Promise<void | SyncClientOutcome> {
  if (!options.workspaceIdentifier || !options.authorityURL || !options.auth) {
    throw new Error("Sync presence requires --workspace, SYNC_AUTHORITY_URL, and SYNC_AUTH_TOKEN");
  }

  const client = createSyncPresenceClient({
    workspaceIdentifier: options.workspaceIdentifier,
    authorityURL: options.authorityURL,
    auth: options.auth,
  });

  try {
    if (!options.watch) {
      await client.refresh();
      const snapshot = client.getSnapshot();

      if (snapshot.status !== "connected")
        throw new Error(snapshot.error ?? "Sync presence is unavailable");

      process.stdout.write(`${JSON.stringify(snapshot)}\n`);

      return;
    }

    return await watchSharedPresence(client);
  } finally {
    await client.close();
  }
}

async function watchSharedPresence(
  client: ReturnType<typeof createSyncPresenceClient>,
): Promise<SyncClientOutcome> {
  const cancellation = new AbortController();
  let signal: "SIGINT" | "SIGTERM" | undefined;
  let changed = Promise.withResolvers<void>();
  let latest = client.getSnapshot();
  const unsubscribe = client.subscribe(() => {
    latest = client.getSnapshot();
    changed.resolve();
  });
  const interrupt = () => {
    signal = "SIGINT";
    cancellation.abort();
    changed.resolve();
  };
  const terminate = () => {
    signal = "SIGTERM";
    cancellation.abort();
    changed.resolve();
  };

  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);

  try {
    while (!cancellation.signal.aborted) {
      const current = latest;

      changed = Promise.withResolvers<void>();
      const output = `${JSON.stringify(current)}\n`;

      if (Buffer.byteLength(output) > 512 * 1024)
        throw new Error("Sync presence snapshot exceeds its byte budget");

      if (!process.stdout.write(output)) {
        try {
          await once(process.stdout, "drain", { signal: cancellation.signal });
        } catch (cause) {
          if (!cancellation.signal.aborted) throw cause;
        }
      }

      if (current.status === "forbidden") throw new Error("Sync presence access is unavailable");

      if (latest === current && !cancellation.signal.aborted) await changed.promise;
    }

    return signal ? { status: "interrupted", signal } : { status: "completed" };
  } finally {
    unsubscribe();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
