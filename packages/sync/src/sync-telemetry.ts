import {
  context,
  trace,
  metrics,
  logs,
  propagation,
  ROOT_CONTEXT,
  isSpanContextValid,
  SpanKind,
  SpanStatusCode,
  SeverityNumber,
  type Context,
  type Tracer,
  type Meter,
  type Logger,
  type SpanContext,
  type TextMapPropagator,
  type MeterProvider,
} from "@opentelemetry/api";
import * as v from "valibot";
import {
  attemptSyncTelemetry,
  runSyncTelemetryContext,
  injectSyncTraceContext,
  extractSyncTraceContext,
  type SyncTelemetryContextScope,
} from "./sync-telemetry-context.ts";
import {
  SyncTelemetryBoundarySchema,
  SyncTelemetryOutcomeSchema,
  SyncTelemetryMeasurementSchema,
  type SyncTelemetryBoundary,
  type SyncTelemetryOutcome,
  type SyncTelemetryMeasurement,
} from "./sync-telemetry-protocol.ts";

export interface SyncTelemetryOptions {
  tracer?: Tracer;
  meter?: Meter;
  logger?: Logger;
  contextScope?: SyncTelemetryContextScope;
  propagator?: TextMapPropagator;
}

/** Providers, exporters, ambient context, and flushing remain owned by the application. */
export function createSyncTelemetry(options: SyncTelemetryOptions = {}) {
  const tracer = () => options.tracer ?? trace.getTracer("@cueloop/sync");
  const logger = () => options.logger ?? logs.getLogger("@cueloop/sync");
  const scope = options.contextScope ?? context;
  const propagator = options.propagator ?? propagation;
  const activeCounts = new Map<SyncTelemetryBoundary, number>();
  const createMeasurements = (meter: Meter) => {
    const activeWork = attemptSyncTelemetry(() =>
      meter.createUpDownCounter("cueloop.sync.active", {
        description: "Active sync work",
        unit: "{work}",
      }),
    );

    for (const [boundary, count] of activeCounts)
      attemptSyncTelemetry(() => activeWork?.add(count, { "sync.boundary": boundary }));

    return {
      activeWork,
      events: attemptSyncTelemetry(() =>
        meter.createCounter("cueloop.sync.events", {
          description: "Sync boundary outcomes",
          unit: "{event}",
        }),
      ),
      duration: attemptSyncTelemetry(() =>
        meter.createHistogram("cueloop.sync.duration", {
          description: "Sync boundary duration",
          unit: "s",
        }),
      ),
      bytes: attemptSyncTelemetry(() =>
        meter.createHistogram("cueloop.sync.bytes", {
          description: "Sync boundary byte count",
          unit: "By",
        }),
      ),
      items: attemptSyncTelemetry(() =>
        meter.createHistogram("cueloop.sync.items", {
          description: "Sync boundary queue count",
          unit: "{item}",
        }),
      ),
      age: attemptSyncTelemetry(() =>
        meter.createHistogram("cueloop.sync.age", {
          description: "Sync subscription stale duration",
          unit: "s",
        }),
      ),
    };
  };
  let measured:
    | { owner: Meter | MeterProvider; instruments: ReturnType<typeof createMeasurements> }
    | undefined;
  const measurements = () => {
    const owner = options.meter ?? metrics.getMeterProvider();

    if (!measured || measured.owner !== owner)
      measured = {
        owner,
        instruments: createMeasurements(options.meter ?? metrics.getMeter("@cueloop/sync")),
      };

    return measured.instruments;
  };
  const active = () => attemptSyncTelemetry(() => scope.active()) ?? ROOT_CONTEXT;
  const event = (
    boundary: SyncTelemetryBoundary,
    outcome: SyncTelemetryOutcome,
    measurement: SyncTelemetryMeasurement = {},
    parent: Context = active(),
  ) => {
    attemptSyncTelemetry(() => {
      v.parse(SyncTelemetryBoundarySchema, boundary);
      v.parse(SyncTelemetryOutcomeSchema, outcome);
      const observed = v.parse(SyncTelemetryMeasurementSchema, measurement);
      const { bytes: observedBytes, items: observedItems, ageSeconds: observedAge } = observed;
      const attributes = { "sync.boundary": boundary, "sync.outcome": outcome };

      attemptSyncTelemetry(() => measurements().events?.add(1, attributes, parent));

      if (observedBytes !== undefined)
        attemptSyncTelemetry(() => measurements().bytes?.record(observedBytes, attributes, parent));

      if (observedItems !== undefined)
        attemptSyncTelemetry(() => measurements().items?.record(observedItems, attributes, parent));

      if (observedAge !== undefined)
        attemptSyncTelemetry(() => measurements().age?.record(observedAge, attributes, parent));

      const logAttributes = { ...attributes };

      if (observed.httpStatus !== undefined)
        Object.assign(logAttributes, { "http.response.status_code": observed.httpStatus });

      attemptSyncTelemetry(() =>
        logger().emit({
          eventName: `cueloop.sync.${boundary}.${outcome}`,
          body: "Sync boundary observation",
          severityNumber:
            outcome === "failed" || outcome === "overflow"
              ? SeverityNumber.ERROR
              : SeverityNumber.INFO,
          attributes: logAttributes,
          context: parent,
        }),
      );
    });
  };
  const start = (
    boundary: SyncTelemetryBoundary,
    configuration: { kind?: SpanKind; parent?: Context; links?: readonly SpanContext[] } = {},
  ) => {
    const parsedBoundary = v.safeParse(SyncTelemetryBoundarySchema, boundary);
    const parent = configuration.parent ?? active();
    const started = performance.now();
    const span = parsedBoundary.success
      ? attemptSyncTelemetry(() =>
          tracer().startSpan(
            `cueloop.sync.${parsedBoundary.output}`,
            {
              kind: configuration.kind ?? SpanKind.INTERNAL,
              attributes: { "sync.boundary": boundary },
              links: configuration.links?.map((context) => ({ context })),
            },
            parent,
          ),
        )
      : undefined;
    const spanContext = span
      ? (attemptSyncTelemetry(() => trace.setSpan(parent, span)) ?? parent)
      : parent;
    let ended = false;

    return {
      context: spanContext,
      spanContext: attemptSyncTelemetry(() => trace.getSpanContext(spanContext)),
      run<Result>(callback: () => Result): Result {
        return runSyncTelemetryContext(scope, spanContext, callback);
      },
      end(outcome: SyncTelemetryOutcome = "completed", measurement?: SyncTelemetryMeasurement) {
        if (ended) return;

        ended = true;
        const parsedOutcome = v.safeParse(SyncTelemetryOutcomeSchema, outcome);

        if (!parsedBoundary.success || !parsedOutcome.success) {
          attemptSyncTelemetry(() => span?.end());

          return;
        }

        attemptSyncTelemetry(() =>
          measurements().duration?.record(
            (performance.now() - started) / 1000,
            { "sync.boundary": boundary, "sync.outcome": outcome },
            spanContext,
          ),
        );
        attemptSyncTelemetry(() =>
          span?.setStatus({
            code: outcome === "failed" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
          }),
        );
        attemptSyncTelemetry(() => span?.end());
        event(boundary, outcome, measurement, spanContext);
      },
    };
  };

  return {
    event,
    start,
    active,
    async run<Result>(
      boundary: SyncTelemetryBoundary,
      operation: () => Result | Promise<Result>,
      describe?: (result: Result) => SyncTelemetryOutcome,
    ): Promise<Result> {
      const observation = start(boundary);

      try {
        const result = await observation.run(operation);
        const outcome = describe ? attemptSyncTelemetry(() => describe(result)) : undefined;

        observation.end(outcome ?? "completed");

        return result;
      } catch (cause) {
        observation.end("failed");

        throw cause;
      }
    },
    activeWork(boundary: SyncTelemetryBoundary, change: 1 | -1) {
      attemptSyncTelemetry(() => {
        v.parse(SyncTelemetryBoundarySchema, boundary);
        v.parse(v.picklist([1, -1]), change);
        const instruments = measurements();
        const previous = activeCounts.get(boundary) ?? 0;
        const next = Math.max(0, previous + change);

        activeCounts.set(boundary, next);
        instruments.activeWork?.add(next - previous, { "sync.boundary": boundary }, active());
      });
    },
    inject(headers: Headers, parent: Context = active()) {
      injectSyncTraceContext(propagator, parent, headers);
    },
    extract(headers: Headers) {
      return extractSyncTraceContext(propagator, headers);
    },
    requestContext(headers: Headers) {
      const current = active();
      const currentSpan = attemptSyncTelemetry(() => trace.getSpanContext(current));

      return currentSpan && attemptSyncTelemetry(() => isSpanContextValid(currentSpan))
        ? current
        : extractSyncTraceContext(propagator, headers);
    },
    traceparent(parent: Context = active()) {
      const headers = new Headers();

      injectSyncTraceContext(propagator, parent, headers);

      return headers.get("traceparent") ?? undefined;
    },
  };
}

export type SyncTelemetry = ReturnType<typeof createSyncTelemetry>;
let defaultTelemetry: SyncTelemetry | undefined;

export function getSyncTelemetry(): SyncTelemetry {
  defaultTelemetry ??= createSyncTelemetry();

  return defaultTelemetry;
}
