import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyncDraftStore } from "./sync-draft-store.ts";
import { createSyncSqliteStorage } from "./sync-sqlite-storage.ts";
import { createSyncQuerySubscription } from "./sync-query.ts";
import { createSyncClient } from "./sync-client.ts";
import { createSchema, table, string, createBuilder } from "./sync-schema.ts";
import { expect, test, spyOn } from "bun:test";
import {
  ROOT_CONTEXT,
  trace,
  metrics,
  logs,
  type Context,
  type TextMapPropagator,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  TracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from "@opentelemetry/sdk-trace";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
  InMemoryLogRecordExporter,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  InMemoryMetricExporter,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { createSyncTelemetry } from "./sync-telemetry.ts";

function createTestSyncTelemetryProviders() {
  const spans = new InMemorySpanExporter();
  const records = new InMemoryLogRecordExporter();
  const measurements = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const tracer = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spans })],
  });
  const logger = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: records })],
  });
  const meter = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({ exporter: measurements, exportIntervalMillis: 60000 }),
    ],
  });

  return {
    spans,
    records,
    measurements,
    tracer,
    logger,
    meter,
    async close() {
      await Promise.all([tracer.shutdown(), logger.shutdown(), meter.shutdown()]);
    },
  };
}

test("consumer instruments export correlated signals without replacing global providers", async () => {
  const providers = createTestSyncTelemetryProviders();
  const globals = {
    tracer: trace.getTracerProvider(),
    meter: metrics.getMeterProvider(),
    logger: logs.getLoggerProvider(),
  };
  const telemetry = createSyncTelemetry({
    tracer: providers.tracer.getTracer("consumer-sync-test"),
    meter: providers.meter.getMeter("consumer-sync-test"),
    logger: providers.logger.getLogger("consumer-sync-test"),
    propagator: new W3CTraceContextPropagator(),
  });

  try {
    const source = telemetry.start("http.client");
    const headers = new Headers({ authorization: "retain-original-credential" });

    telemetry.inject(headers, source.context);
    const destination = telemetry.start("authority.request", {
      parent: telemetry.extract(headers),
    });

    telemetry.activeWork("query.subscription", 1);
    destination.end("accepted", { bytes: 32, items: 1, httpStatus: 200 });
    source.end();
    telemetry.activeWork("query.subscription", -1);
    await Promise.all([
      providers.tracer.forceFlush(),
      providers.logger.forceFlush(),
      providers.meter.forceFlush(),
    ]);
    const finished = providers.spans.getFinishedSpans();
    const remote = finished.find((span) => span.name === "cueloop.sync.authority.request");
    const local = finished.find((span) => span.name === "cueloop.sync.http.client");

    expect(remote?.spanContext().traceId).toBe(local?.spanContext().traceId);
    expect(remote?.parentSpanContext?.spanId).toBe(local?.spanContext().spanId);
    expect(remote?.instrumentationScope.name).toBe("consumer-sync-test");
    expect(
      providers.records
        .getFinishedLogRecords()
        .some((record) => record.spanContext?.traceId === remote?.spanContext().traceId),
    ).toBe(true);
    expect(
      providers.measurements
        .getMetrics()
        .flatMap((resource) =>
          resource.scopeMetrics.flatMap((scope) =>
            scope.metrics.map((metric) => metric.descriptor.name),
          ),
        ),
    ).toContain("cueloop.sync.events");
    expect(headers.get("authorization")).toBe("retain-original-credential");
    expect(
      JSON.stringify({
        spans: finished.map((span) => span.attributes),
        logs: providers.records
          .getFinishedLogRecords()
          .map((record) => ({ body: record.body, attributes: record.attributes })),
        metrics: providers.measurements.getMetrics(),
      }),
    ).not.toContain("retain-original-credential");
    expect(trace.getTracerProvider()).toBe(globals.tracer);
    expect(metrics.getMeterProvider()).toBe(globals.meter);
    expect(logs.getLoggerProvider()).toBe(globals.logger);
  } finally {
    await providers.close();
  }
});

test("throwing instruments and context providers cannot repeat or fail committed work", async () => {
  const providers = createTestSyncTelemetryProviders();
  const tracer = providers.tracer.getTracer("throwing-consumer");
  const meter = providers.meter.getMeter("throwing-consumer");
  const logger = providers.logger.getLogger("throwing-consumer");
  const interceptors = [
    spyOn(tracer, "startSpan").mockImplementation(() => {
      throw new Error("Collector unavailable");
    }),
    spyOn(meter, "createCounter").mockImplementation(() => {
      throw new Error("Metric unavailable");
    }),
    spyOn(meter, "createHistogram").mockImplementation(() => {
      throw new Error("Metric unavailable");
    }),
    spyOn(meter, "createUpDownCounter").mockImplementation(() => {
      throw new Error("Metric unavailable");
    }),
    spyOn(logger, "emit").mockImplementation(() => {
      throw new Error("Log unavailable");
    }),
  ];
  const telemetry = createSyncTelemetry({
    tracer,
    meter,
    logger,
    contextScope: {
      active: () => ROOT_CONTEXT,
      with<Result>(_parent: Context, callback: () => Result): Result {
        callback();
        throw new Error("Context failed after calling application code");
      },
    },
  });

  try {
    let writes = 0;
    const observation = telemetry.start("transaction.commit");
    const result = observation.run(() => {
      writes += 1;

      return "committed";
    });

    observation.end("accepted");
    telemetry.activeWork("query.subscription", 1);
    telemetry.event("query.subscription", "overflow", { bytes: 256 });
    expect(result).toBe("committed");
    expect(writes).toBe(1);
    const applicationError = new Error("Application failure");

    expect(() =>
      observation.run(() => {
        throw applicationError;
      }),
    ).toThrow(applicationError);
  } finally {
    for (const interceptor of interceptors) interceptor.mockRestore();

    await providers.close();
  }
});

test("propagation exposes only bounded W3C context to a configured propagator", () => {
  const observed: string[] = [];
  const propagator: TextMapPropagator = {
    fields: () => ["traceparent", "tracestate", "authorization", "baggage"],
    inject(parent, carrier, setter) {
      void parent;
      setter.set(carrier, "authorization", "must-not-propagate");
      setter.set(carrier, "baggage", "actor=private-user");
      setter.set(carrier, "traceparent", "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01");
    },
    extract(parent, carrier, getter) {
      observed.push(...getter.keys(carrier));

      if (getter.get(carrier, "tracestate") !== undefined) observed.push("unbounded trace state");

      if (getter.get(carrier, "authorization") !== undefined) observed.push("credential leak");

      return parent;
    },
  };
  const telemetry = createSyncTelemetry({ propagator });
  const headers = new Headers({
    authorization: "original-credential",
    baggage: "actor=private-user",
  });

  telemetry.inject(headers);
  headers.set("tracestate", "x".repeat(513));
  telemetry.extract(headers);
  expect(headers.get("authorization")).toBe("original-credential");
  expect(observed).toEqual(["traceparent", "tracestate"]);
});

test("real draft and query budgets and a failed SQLite open emit bounded observations", async () => {
  const providers = createTestSyncTelemetryProviders();
  const telemetry = createSyncTelemetry({
    tracer: providers.tracer.getTracer("sync-failure-test"),
    meter: providers.meter.getMeter("sync-failure-test"),
    logger: providers.logger.getLogger("sync-failure-test"),
  });
  const directory = mkdtempSync(join(tmpdir(), "cueloop-sync-telemetry-failures-"));
  const storage = createSyncSqliteStorage({ directory, telemetry });
  const drafts = createSyncDraftStore({
    storage,
    authorityIdentifier: "private-authority",
    userIdentifier: "private-actor",
    maximumItems: 1,
    telemetry,
  });
  const schema = createSchema({
    tables: [table("record").columns({ id: string() }).primaryKey("id")],
  });
  const client = createSyncClient({ schema, kvStore: "mem", cacheURL: null, telemetry });

  try {
    const draft = await drafts.save({ content: "Private retained draft body" });

    await expect(drafts.save({ content: "Private unsaved draft body" })).rejects.toThrow(
      "item budget",
    );
    expect(await drafts.list()).toEqual([draft]);
    const query = createSyncQuerySubscription({
      client,
      view: client.materialize(createBuilder(schema).record),
      maximumBytes: 1,
      telemetry,
    });

    await expect(query.next()).rejects.toThrow("byte budget");
    expect(query.signal.aborted).toBe(true);
    chmodSync(directory, 0o500);
    expect(() => storage.create("cannot-open-after-directory-readonly")).toThrow();
    await providers.logger.forceFlush();
    const observations = providers.records
      .getFinishedLogRecords()
      .map((record) => record.attributes);

    for (const [boundary, outcome] of [
      ["draft.queue", "overflow"],
      ["query.subscription", "overflow"],
      ["storage", "failed"],
    ])
      expect(
        observations.some(
          (attributes) =>
            attributes["sync.boundary"] === boundary && attributes["sync.outcome"] === outcome,
        ),
      ).toBe(true);

    expect(JSON.stringify(observations)).not.toContain("private-");
  } finally {
    chmodSync(directory, 0o700);
    await client.close();
    await drafts.close();
    await providers.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
