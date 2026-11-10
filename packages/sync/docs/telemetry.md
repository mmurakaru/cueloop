# Telemetry and deployment health

The SDK emits OpenTelemetry traces, metrics, and structured logs at sync boundaries.
The application owns providers, exporters, sampling, resources, and shutdown.
Importing the SDK does not register or replace global providers.

## Configure export

Configure your OpenTelemetry SDK before opening sync clients or serving requests.
Use OTLP exporters to send traces, metrics, and logs to your collector.
The library depends only on `@opentelemetry/api`.
Exporter packages belong to the application.

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";

const telemetry = new NodeSDK({
  autoDetectResources: false,
  resource: resourceFromAttributes({ "service.name": "my-sync-authority" }),
  spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })],
  metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })],
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
});

telemetry.start();
```

This example uses `@opentelemetry/sdk-node` and the OTLP exporters at 0.301.1, with `@opentelemetry/sdk-trace`, `sdk-metrics`, `sdk-logs`, and `resources` at 3.1.1.
Configure the collector endpoint with your exporters' `OTEL_EXPORTER_OTLP_ENDPOINT` setting.
Use bounded exporter timeouts and batch processors.
The application can enable host or process resource detection when its privacy policy allows it.

> [!IMPORTANT]
> Export is independent of authoritative commits.
> A failed exporter does not change a receipt or trigger a retry.
> Stop sync work before you flush and shut down the application's providers.

Use API 1.10-compatible global providers.
An application with isolated providers or an older global registration can pass its own `tracer`, `meter`, `logger`, `contextScope`, and `propagator` to `createSyncTelemetry` from `@cueloop/sync/telemetry`.
Pass that telemetry instance to clients, authority database adapters, HTTP servers, subscriptions, storage, drafts, or execution integrations.
Browser applications use browser-compatible providers and context management.
Node SDK packages stay outside browser entry points.

## Follow an operation

The SDK propagates W3C `traceparent` and `tracestate` through its HTTP clients and the Zero transport hook.
`serveSyncApplication` extracts that context into an HTTP server span.
The authority handler and transaction spans inherit the request context.
A Zero transport batch can link several pending mutations.
Configure W3C context propagation on the Zero cache as well as the client and authority.
For a cache that only relays trace context, use:

```sh
OTEL_TRACES_EXPORTER=none
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
OTEL_PROPAGATORS=tracecontext
```

Zero 1.11.4 initializes its context manager and propagator when these exporter settings are present.
Without cache context propagation, client mutation spans and authority transaction spans have separate traces.
A cache that exports its own telemetry can use its configured exporters with the same W3C propagator.

The trace context does not change operation envelopes or receipt identities.

Application-specific HTTP clients can use the same propagation:

```ts
import { fetchSyncHttp } from "@cueloop/sync/telemetry/http";

const response = await fetchSyncHttp(url, {
  method: "POST",
  headers: { authorization: `Bearer ${auth}` },
  body: JSON.stringify(savedOperation),
});
```

Telemetry uses fixed boundary and outcome names.
It reports operation acceptance, rejection, uncertainty, recovery, commit completion, execution dispatch, reconnects, subscription freshness, queue overflow, and storage failure.
A completed `transaction.commit` span means the database transaction resolved successfully.
Acceptance and execution remain separate outcomes.

Metrics use `cueloop.sync.events`, `cueloop.sync.duration`, `cueloop.sync.active`, `cueloop.sync.bytes`, `cueloop.sync.items`, and `cueloop.sync.age`.
Duration and age use seconds.
Byte measurements use bytes.
Subscription age measures the stale interval when a subscription becomes complete again.
Attributes contain bounded `sync.boundary` and `sync.outcome` values.
Logs can also contain the HTTP response status.

> [!NOTE]
> Default sync telemetry excludes document bodies, draft text, credentials, database URLs, local paths, raw errors, and user or workspace identifiers.
> Propagation forwards only W3C trace headers.
> Application instrumentation, resources, and other dependencies can add their own data.

## Check health and readiness

`serveSyncApplication` exposes `GET /health` for process liveness and `GET /ready` for application readiness.
A host without a readiness callback reports `initializing` with HTTP 503.
A failed or timed-out callback reports `unavailable` with HTTP 503.
The callback receives an abort signal and should cancel its own pending work.

```ts
export const syncApplication = {
  fetch: handleRequest,
  readiness: async (signal: AbortSignal) => {
    const state = await readApplicationAuthority(signal);

    return { ready: state.phase === "active", phase: state.phase };
  },
  close: stopApplicationResources,
};
```

Readiness reports a bounded phase and boolean, without authority identifiers or error details.
Only `active` can report `ready: true`.
Check the dependencies and authority fences required by your deployment in this callback.
A healthy telemetry collector is not a prerequisite for accepting sync work.
Client query freshness remains a separate signal.
The CLI emits `sync.authority.listening` when it binds its port.

## Shut down

`server.close()` marks readiness as closing and stops admitting requests.
It waits for admitted handlers and response writes, closes the HTTP server, and then calls the application's `close` callback.
Repeated calls return the same promise.
The default shutdown deadline is 30 seconds.
The host can set `shutdownTimeoutMilliseconds` and `readinessTimeoutMilliseconds` on `serveSyncApplication`.

If shutdown exceeds its deadline, the server aborts the request signal, closes connections, and rejects with a bounded error.
Application code must honor cancellation for its own work.
After sync shutdown, call your telemetry SDK's `shutdown()` to finish export.
