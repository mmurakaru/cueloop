import { SpanKind } from "@opentelemetry/api";
import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";

/** Trace headers are separate from durable operation envelopes and carry no application identifiers. */
export async function fetchSyncHttp(
  url: URL,
  options: RequestInit,
  telemetry: SyncTelemetry = getSyncTelemetry(),
  send: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const observation = telemetry.start("http.client", { kind: SpanKind.CLIENT });
  const headers = new Headers(options.headers);

  telemetry.inject(headers, observation.context);

  try {
    const response = await observation.run(() => send(url, { ...options, headers }));

    observation.end(response.status >= 500 ? "failed" : "completed", {
      httpStatus: response.status,
    });

    return response;
  } catch (cause) {
    observation.end("failed");

    throw cause;
  }
}
