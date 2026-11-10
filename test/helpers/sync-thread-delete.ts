import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";

export async function recoverTestSyncDeletedThread(options: {
  server: DaemonServer;
  client: DaemonClient;
  home: string;
  threadIdentifier: string;
  gate: { received: Promise<void>; processed: Promise<void>; forward(): void };
}) {
  const interrupted = options.client.sessionDelete(options.threadIdentifier).catch(() => undefined);

  await options.gate.received;
  options.gate.forward();
  await options.gate.processed;
  options.client.close();
  await options.server.shutdown();
  await interrupted;
  const server = new DaemonServer({
    home: options.home,
    idleExitMs: 0,
    sync: { enabledForThread: () => true },
  });
  let client: DaemonClient | undefined;

  server.start();

  try {
    client = await DaemonClient.connect({ home: options.home });
    const draft = (await client.sessionSyncDrafts(options.threadIdentifier)).find((record) =>
      record.content.includes("session.delete"),
    );

    if (!draft)
      throw new Error("Accepted deletion must retain its operation for interrupted local cleanup");

    await client.sessionSyncRetry(options.threadIdentifier, draft.draftIdentifier);

    return { server, client };
  } catch (cause) {
    client?.close();
    await server.shutdown();

    throw cause;
  }
}
