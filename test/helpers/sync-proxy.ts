import { createConnection, createServer, type Socket } from "node:net";
import * as v from "valibot";

export async function createTestSyncProxy(targetURL: string) {
  const target = new URL(targetURL);
  const sockets = new Set<Socket>();
  let connected = true;
  const server = createServer((incoming) => {
    if (!connected) {
      incoming.destroy();

      return;
    }

    const upstream = createConnection({ host: target.hostname, port: Number(target.port) });

    for (const socket of [incoming, upstream]) {
      sockets.add(socket);
      socket.on("error", () => {
        incoming.destroy();
        upstream.destroy();
      });
      socket.on("close", () => {
        sockets.delete(socket);
        incoming.destroy();
        upstream.destroy();
      });
    }

    incoming.pipe(upstream).pipe(incoming);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = v.parse(v.object({ port: v.number() }), server.address());

  return {
    cacheURL: `http://127.0.0.1:${address.port}`,
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
