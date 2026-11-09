import type { SyncTextEditorSession } from "./sync-text-session.ts";
import { createServer } from "node:http";
import * as v from "valibot";

export type SyncClientOutcome =
  | { status: "completed" }
  | { status: "interrupted"; signal: "SIGINT" | "SIGTERM" };

export interface SyncApplication {
  fetch: (request: Request) => Response | Promise<Response>;
  connect?: (arguments_: string[]) => Promise<void | SyncClientOutcome>;
  openText?: (arguments_: string[]) => Promise<SyncTextEditorSession>;
  close?: () => void | Promise<void>;
}

function isSyncOrigin(origin: URL): boolean {
  return (
    (origin.protocol === "http:" || origin.protocol === "https:") &&
    !origin.username &&
    !origin.password &&
    origin.pathname === "/" &&
    !origin.search &&
    !origin.hash
  );
}

export async function serveSyncApplication(
  application: SyncApplication,
  options: {
    host?: string;
    port?: number;
    maximumRequestBytes?: number;
    publicOrigin?: string;
  } = {},
) {
  const host = options.host ?? "127.0.0.1";
  const maximumRequestBytes = options.maximumRequestBytes ?? 1048576;
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin) : undefined;

  if (publicOrigin && !isSyncOrigin(publicOrigin)) {
    throw new Error("Sync authority public origin must be an HTTP or HTTPS origin");
  }

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
      const origin = publicOrigin ?? new URL(`http://${incoming.headers.host ?? "localhost"}`);
      const url = new URL(incoming.url ?? "/", origin);

      if (url.origin !== origin.origin || !isSyncOrigin(origin)) {
        outgoing.writeHead(400).end("Invalid request authority");

        return;
      }

      const request = new Request(url.href, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
      });
      const response = await application.fetch(request);

      outgoing.writeHead(response.status, {
        ...Object.fromEntries(response.headers),
        "set-cookie": response.headers.getSetCookie(),
      });
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
