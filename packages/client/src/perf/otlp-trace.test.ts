import { afterEach, expect, test } from "bun:test";
import {
  buildOtlpTracePayload,
  phaseMarksToSpans,
  postOtlpTrace,
  type TraceSpan,
} from "./otlp-trace";

afterEach(() => {
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
});

const span: TraceSpan = {
  traceId: "0123456789abcdef0123456789abcdef",
  spanId: "0123456789abcdef",
  name: "cueloop.interaction",
  startTimeUnixNano: "1000",
  endTimeUnixNano: "2000",
  attributes: [
    { key: "terminal.trigger", value: { stringValue: "key:j" } },
    { key: "terminal.frame.budget_ms", value: { doubleValue: 16.7 } },
    { key: "terminal.backpressure", value: { boolValue: true } },
  ],
};

test("buildOtlpTracePayload carries service.name and maps scalar attributes to OTLP values", () => {
  const payload = buildOtlpTracePayload("cueloop-client", [span]);

  expect(payload).toEqual({
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "cueloop-client" } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: "0123456789abcdef0123456789abcdef",
                spanId: "0123456789abcdef",
                parentSpanId: "",
                name: "cueloop.interaction",
                startTimeUnixNano: "1000",
                endTimeUnixNano: "2000",
                attributes: [
                  { key: "terminal.trigger", value: { stringValue: "key:j" } },
                  { key: "terminal.frame.budget_ms", value: { doubleValue: 16.7 } },
                  { key: "terminal.backpressure", value: { boolValue: true } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
});

test("phaseMarksToSpans builds a scope root with one child span per phase under one trace", () => {
  const spans = phaseMarksToSpans("startup", [
    { label: "renderer", elapsedMs: 10 },
    { label: "firstFrame", elapsedMs: 20 },
  ]);

  expect(spans).toHaveLength(3);
  const [root, first, second] = spans;
  expect(root!.name).toBe("cueloop.startup");
  expect(root!.parentSpanId).toBeUndefined();
  expect(first!.name).toBe("cueloop.startup.renderer");
  expect(first!.parentSpanId).toBe(root!.spanId);
  expect(second!.parentSpanId).toBe(root!.spanId);
  expect(new Set(spans.map((each) => each.traceId)).size).toBe(1);
});

test("postOtlpTrace sends no request when the endpoint is unset", async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(request.url);

      return new Response("{}");
    },
  });
  try {
    await postOtlpTrace("cueloop-client", [span]);
  } finally {
    await server.stop(true);
  }

  expect(requests).toHaveLength(0);
});

test("postOtlpTrace POSTs OTLP JSON to /v1/traces when the endpoint is set", async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push(`${request.method} ${new URL(request.url).pathname}\n${await request.text()}`);

      return new Response("{}");
    },
  });
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${server.port}`;
  try {
    await postOtlpTrace("cueloop-client", [span]);
  } finally {
    await server.stop(true);
  }

  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("POST /v1/traces");
  expect(requests[0]).toContain('"service.name"');
  expect(requests[0]).toContain("cueloop.interaction");
});
