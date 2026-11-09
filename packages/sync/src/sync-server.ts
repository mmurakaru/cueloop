import { createServer } from "node:http";
import * as v from "valibot";

export interface SyncApplication {
  fetch: (request: Request) => Response | Promise<Response>;
  connect?: (arguments_: string[]) => Promise<void>;
  close?: () => void | Promise<void>;
}

export async function serveSyncApplication(
  application: SyncApplication,
  options: { host?: string; port?: number; maximumRequestBytes?: number } = {},
) {
  const host = options.host ?? "127.0.0.1";
  const maximumRequestBytes = options.maximumRequestBytes ?? 1048576;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let length = 0;

      for await (const chunk of incoming) {
        length += chunk.length;

        if (length > maximumRequestBytes) {
          outgoing.writeHead(413).end("Request body is too large");

          return;
        }

        chunks.push(Buffer.from(chunk));
      }

      const headers = new Headers();

      for (const [name, value] of Object.entries(incoming.headers)) {
        for (const entry of Array.isArray(value) ? value : value ? [value] : []) {
          headers.append(name, entry);
        }
      }

      const method = incoming.method ?? "GET";
      const request = new Request(new URL(incoming.url ?? "/", "http://localhost"), {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
      });
      const response = await application.fetch(request);

      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);

      outgoing.end("Sync authority request failed");
    }
  });

  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4849, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = v.parse(v.object({ port: v.number() }), server.address());

  return {
    port: address.port,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await application.close?.();
    },
  };
}
