import { SpanKind } from "@opentelemetry/api";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SyncApplication } from "./sync-server-protocol.ts";
import type { SyncServerState } from "./sync-server-readiness.ts";
import type { SyncTelemetry } from "./sync-telemetry.ts";

export function isSyncOrigin(origin: URL): boolean {
  return (
    ["http:", "https:"].includes(origin.protocol) &&
    !origin.username &&
    !origin.password &&
    origin.pathname === "/" &&
    !origin.search &&
    !origin.hash
  );
}

function syncIncomingHeaders(incoming: IncomingMessage): Headers {
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming.headers)) {
    for (const entry of Array.isArray(value) ? value : value ? [value] : [])
      headers.append(name, entry);
  }

  return headers;
}

async function readSyncRequestBody(incoming: IncomingMessage, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of incoming) {
    length += chunk.length;

    if (length > maximumBytes) return { status: "overflow" as const, bytes: length };

    chunks.push(Buffer.from(chunk));
  }

  return { status: "complete" as const, body: Buffer.concat(chunks) };
}

async function readSyncHealthResponse(
  method: string,
  pathname: string,
  state: SyncServerState,
): Promise<Response | undefined> {
  if (method !== "GET" || !["/health", "/ready"].includes(pathname)) return undefined;

  const snapshot = pathname === "/health" ? state.liveness() : await state.readiness();
  const status = "ready" in snapshot && !snapshot.ready ? 503 : 200;

  return Response.json(snapshot, { status });
}

export async function handleSyncApplicationRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  options: {
    application: SyncApplication;
    publicOrigin?: URL;
    maximumRequestBytes: number;
    state: SyncServerState;
    telemetry: SyncTelemetry;
    signal: AbortSignal;
  },
): Promise<void> {
  const completed = new Promise<void>((resolve) => {
    outgoing.once("finish", resolve);
    outgoing.once("close", resolve);
  });
  let observation: ReturnType<SyncTelemetry["start"]> | undefined;
  let admitted = false;
  let status = 500;

  try {
    const headers = syncIncomingHeaders(incoming);

    observation = options.telemetry.start("http.server", {
      kind: SpanKind.SERVER,
      parent: options.telemetry.extract(headers),
    });
    admitted = options.state.admit();

    if (!admitted) {
      status = 503;
      outgoing.writeHead(status).end("Sync authority is shutting down");

      return;
    }

    const method = incoming.method ?? "GET";
    const origin =
      options.publicOrigin ?? new URL(`http://${incoming.headers.host ?? "localhost"}`);
    const url = new URL(incoming.url ?? "/", origin);

    if (url.origin !== origin.origin || !isSyncOrigin(origin)) {
      status = 400;
      outgoing.writeHead(status).end("Invalid request authority");

      return;
    }

    const health = await readSyncHealthResponse(method, url.pathname, options.state);

    if (health) {
      status = health.status;
      outgoing.writeHead(status, { "content-type": "application/json" }).end(await health.text());

      return;
    }

    const body = await readSyncRequestBody(incoming, options.maximumRequestBytes);

    if (body.status === "overflow") {
      status = 413;
      options.telemetry.event("http.server", "overflow", { bytes: body.bytes });
      outgoing.writeHead(status).end("Request body is too large");

      return;
    }

    const request = new Request(url.href, {
      method,
      headers,
      signal: options.signal,
      body: method === "GET" || method === "HEAD" ? undefined : body.body,
    });
    const response = await observation.run(() => options.application.fetch(request));

    status = response.status;
    outgoing.writeHead(status, {
      ...Object.fromEntries(response.headers),
      "set-cookie": response.headers.getSetCookie(),
    });
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    status = 500;

    if (!outgoing.headersSent) outgoing.writeHead(status);

    outgoing.end("Sync authority request failed");
  } finally {
    await completed;
    observation?.end(status >= 500 ? "failed" : "completed", { httpStatus: status });

    if (admitted) options.state.finish();
  }
}
