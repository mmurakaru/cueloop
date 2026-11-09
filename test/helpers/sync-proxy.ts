import { createConnection, createServer, type Socket } from "node:net";
import * as v from "valibot";

export async function createTestSyncProxy(targetURL: string) {
  const target = new URL(targetURL);
  const sockets = new Set<Socket>();
  const serverSources = new Set<Socket>();
  let serverOutputPaused = false;
  let connected = true;
  const server = createServer((incoming) => {
    if (!connected) {
      incoming.destroy();

      return;
    }

    const upstream = createConnection({ host: target.hostname, port: Number(target.port) });

    serverSources.add(upstream);

    for (const socket of [incoming, upstream]) {
      sockets.add(socket);
      socket.on("error", () => {
        incoming.destroy();
        upstream.destroy();
      });
      socket.on("close", () => {
        sockets.delete(socket);
        serverSources.delete(upstream);
        incoming.destroy();
        upstream.destroy();
      });
    }

    incoming.pipe(upstream).pipe(incoming);

    if (serverOutputPaused) upstream.pause();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = v.parse(v.object({ port: v.number() }), server.address());

  return {
    cacheURL: `http://127.0.0.1:${address.port}`,
    pauseServerOutput() {
      serverOutputPaused = true;

      for (const source of serverSources) source.pause();
    },
    resumeServerOutput() {
      serverOutputPaused = false;

      for (const source of serverSources) source.resume();
    },
    disconnect() {
      connected = false;

      for (const socket of sockets) socket.destroy();
    },
    reconnect() {
      connected = true;
    },
    async close() {
      connected = false;

      for (const socket of sockets) socket.destroy();

      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
