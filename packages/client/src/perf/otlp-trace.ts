/**
 * Ship perf spans to a local OTLP/HTTP trace viewer (kundi) so an interaction's phases read as a
 * callstack. Every export is a no-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set. Tracing never throws
 * into the app: a failed POST is swallowed. Attributes are scalar-only, matching the viewer's decoder.
 */

import type { PhaseMark } from "./perf-timings";

export type SpanAttributeValue =
  | { stringValue: string }
  | { doubleValue: number }
  | { boolValue: boolean };

export interface SpanAttribute {
  key: string;
  value: SpanAttributeValue;
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: readonly SpanAttribute[];
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);

  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A 16-byte trace id as 32 lowercase hex chars, per the OTLP wire format. */
export function newTraceId(): string {
  return randomHex(16);
}

/** An 8-byte span id as 16 lowercase hex chars, per the OTLP wire format. */
export function newSpanId(): string {
  return randomHex(8);
}

/** Build the OTLP/JSON `resourceSpans` body the trace viewer's `/v1/traces` decoder reads. */
export function buildOtlpTracePayload(serviceName: string, spans: readonly TraceSpan[]) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              // the viewer reads a missing parent as root; an empty string is the same, without a conditional key
              parentSpanId: span.parentSpanId ?? "",
              name: span.name,
              startTimeUnixNano: span.startTimeUnixNano,
              endTimeUnixNano: span.endTimeUnixNano,
              attributes: (span.attributes ?? []).map((attribute) => ({
                key: attribute.key,
                value: attribute.value,
              })),
            })),
          },
        ],
      },
    ],
  };
}

function nanosFromPerfMs(milliseconds: number): string {
  const originNs = BigInt(Math.round(performance.timeOrigin * 1e6));

  return String(originNs + BigInt(Math.round(milliseconds * 1e6)));
}

/** Turn drained phase marks into a span tree: a `scope` root with one child span per phase, in order. */
export function phaseMarksToSpans(scope: string, marks: readonly PhaseMark[]): TraceSpan[] {
  const totalMs = marks.reduce((sum, mark) => sum + mark.elapsedMs, 0);
  const endMs = performance.now();
  const startMs = endMs - totalMs;
  const traceId = newTraceId();
  const rootSpanId = newSpanId();
  const root: TraceSpan = {
    traceId,
    spanId: rootSpanId,
    name: `cueloop.${scope}`,
    startTimeUnixNano: nanosFromPerfMs(startMs),
    endTimeUnixNano: nanosFromPerfMs(endMs),
  };

  let cursorMs = startMs;
  const children = marks.map((mark) => {
    const phaseStartMs = cursorMs;
    cursorMs += mark.elapsedMs;

    return {
      traceId,
      spanId: newSpanId(),
      parentSpanId: rootSpanId,
      name: `cueloop.${scope}.${mark.label}`,
      startTimeUnixNano: nanosFromPerfMs(phaseStartMs),
      endTimeUnixNano: nanosFromPerfMs(cursorMs),
    };
  });

  return [root, ...children];
}

/** POST the spans to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` as OTLP/JSON; a no-op when the endpoint is unset. */
export async function postOtlpTrace(
  serviceName: string,
  spans: readonly TraceSpan[],
): Promise<void> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint === undefined || spans.length === 0) return;

  await fetch(`${endpoint}/v1/traces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildOtlpTracePayload(serviceName, spans)),
  }).catch(() => undefined);
}
