import { createServer } from "node:http";
import * as v from "valibot";
import { getSyncTelemetry, type SyncTelemetry } from "./sync-telemetry.ts";
import { createSyncServerReadiness } from "./sync-server-readiness.ts";
import { handleSyncApplicationRequest, isSyncOrigin } from "./sync-http-server-request.ts";
import type { SyncApplication } from "./sync-server-protocol.ts";

export {
  SyncServerReadinessSchema,
  type SyncServerReadiness,
  type SyncApplication,
  type SyncClientOutcome,
} from "./sync-server-protocol.ts";

export function parseSyncRequestByteBudget(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 64 * 1024 * 1024)
    throw new Error("Sync authority request byte budget must be an integer between 1 and 67108864");

  return value;
}

export async function serveSyncApplication(
  application: SyncApplication,
  options: {
    host?: string;
    port?: number;
    maximumRequestBytes?: number;
    publicOrigin?: string;
    readinessTimeoutMilliseconds?: number;
    shutdownTimeoutMilliseconds?: number;
    telemetry?: SyncTelemetry;
  } = {},
) {
  const host = options.host ?? "127.0.0.1";
  const maximumRequestBytes = parseSyncRequestByteBudget(options.maximumRequestBytes ?? 1048576);
  const publicOrigin = options.publicOrigin ? new URL(options.publicOrigin) : undefined;
  const telemetry = options.telemetry ?? getSyncTelemetry();
  const timeoutSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(300000));
  const readinessTimeoutMilliseconds = v.parse(
    timeoutSchema,
    options.readinessTimeoutMilliseconds ?? 5000,
  );
  const shutdownTimeoutMilliseconds = v.parse(
    timeoutSchema,
    options.shutdownTimeoutMilliseconds ?? 30000,
  );

  if (publicOrigin && !isSyncOrigin(publicOrigin))
    throw new Error("Sync authority public origin must be an HTTP or HTTPS origin");

  const cancellation = new AbortController();
  const state = createSyncServerReadiness({
    probe: application.readiness,
    timeoutMilliseconds: readinessTimeoutMilliseconds,
    telemetry,
  });
  const inFlight = new Set<Promise<void>>();
  const server = createServer((incoming, outgoing) => {
    const request = handleSyncApplicationRequest(incoming, outgoing, {
      application,
      publicOrigin,
      maximumRequestBytes,
      state,
      telemetry,
      signal: cancellation.signal,
    });

    inFlight.add(request);
    void request.then(
      () => inFlight.delete(request),
      () => inFlight.delete(request),
    );
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
  let closing: Promise<void> | undefined;

  return {
    port: address.port,
    liveness: state.liveness,
    readiness: state.readiness,
    close(): Promise<void> {
      if (closing) return closing;

      const completion = Promise.withResolvers<void>();

      closing = completion.promise;
      state.beginClose();
      const observation = telemetry.start("server.shutdown");
      const expired = Promise.withResolvers<never>();
      const timer = setTimeout(() => {
        cancellation.abort();
        server.closeAllConnections();
        expired.reject(new Error("Sync authority shutdown deadline exceeded"));
      }, shutdownTimeoutMilliseconds);
      const stop = async () => {
        const stopped = new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );

        await Promise.all(inFlight);
        server.closeIdleConnections();
        await stopped;
        await application.close?.(cancellation.signal);
        state.closed();
      };

      void Promise.race([stop(), expired.promise])
        .then(
          () => {
            observation.end("closed");
            completion.resolve();
          },
          (cause) => {
            observation.end("failed");

            completion.reject(cause);
          },
        )
        .finally(() => clearTimeout(timer));

      return closing;
    },
  };
}
