import { expect, test } from "bun:test";
import { v7 as createAuthorityGeneration } from "uuid";
import { fileURLToPath } from "node:url";
import { createTestSyncStack } from "../helpers/sync-stack";
import { createTestSyncTelemetryCollector } from "../helpers/sync-telemetry-collector";
import { waitForTestSyncState } from "../helpers/sync-test-deadline";
import postgres from "postgres";
import * as v from "valibot";

const SignalSchema = v.object({
  resourceSpans: v.optional(
    v.array(
      v.object({
        resource: v.object({
          attributes: v.array(
            v.object({ key: v.string(), value: v.object({ stringValue: v.optional(v.string()) }) }),
          ),
        }),
        scopeSpans: v.array(
          v.object({
            spans: v.array(
              v.object({
                name: v.string(),
                traceId: v.string(),
                spanId: v.string(),
                parentSpanId: v.optional(v.string()),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
});
const parseSpans = (output: string) =>
  output
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => v.parse(SignalSchema, JSON.parse(line)).resourceSpans ?? [])
    .flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) =>
        scope.spans.map((span) => ({
          ...span,
          service: resource.resource.attributes.find(
            (attribute) => attribute.key === "service.name",
          )?.value.stringValue,
        })),
      ),
    );

type TestSyncCollectedSpan = ReturnType<typeof parseSpans>[number];

function hasTestSyncTraceAncestor(
  spans: ReadonlyMap<string, TestSyncCollectedSpan>,
  descendant: TestSyncCollectedSpan,
  ancestor: TestSyncCollectedSpan,
): boolean {
  const seen = new Set<string>();
  let current: TestSyncCollectedSpan | undefined = descendant;

  while (current && !seen.has(current.spanId)) {
    if (current.traceId === ancestor.traceId && current.spanId === ancestor.spanId) return true;

    seen.add(current.spanId);
    current = spans.get(`${current.traceId}:${current.parentSpanId}`);
  }

  return false;
}

async function verifyTestSyncAuthorityReadiness(
  stack: Awaited<ReturnType<typeof createTestSyncStack>>,
) {
  const health = await fetch(`${stack.authorityURL}/health`);
  const readiness = await fetch(`${stack.authorityURL}/ready`);

  expect(health.status).toBe(200);
  expect(readiness.status).toBe(200);
  expect(await readiness.json()).toEqual({ ready: true, phase: "active" });
  const database = postgres(stack.environment.SYNC_DATABASE_URL);

  try {
    await database`UPDATE sync_authority SET phase = 'fenced' WHERE singleton`;
    const fenced = await fetch(`${stack.authorityURL}/ready`);

    expect(fenced.status).toBe(503);
    expect(await fenced.json()).toEqual({ ready: false, phase: "fenced" });
    expect((await fetch(`${stack.authorityURL}/health`)).status).toBe(200);
    await database`UPDATE sync_authority SET phase = 'active', generation = ${createAuthorityGeneration()} WHERE singleton`;
    const obsolete = await fetch(`${stack.authorityURL}/ready`);

    expect(obsolete.status).toBe(503);
    expect(await obsolete.json()).toEqual({ ready: false, phase: "fenced" });
    expect((await fetch(`${stack.authorityURL}/health`)).status).toBe(200);
    await database`UPDATE sync_authority SET generation = ${stack.authority.generation} WHERE singleton`;
  } finally {
    await database.end();
  }
}

async function runTestSyncTelemetryConsumer(
  runtime: string,
  script: string,
  stack: Awaited<ReturnType<typeof createTestSyncStack>>,
  endpoint: string,
) {
  const child = Bun.spawn([runtime, script], {
    env: {
      ...stack.environment,
      CUELOOP_TEST_OTLP_ENDPOINT: endpoint,
      CUELOOP_TEST_AUTHORITY: JSON.stringify(stack.authority),
      CUELOOP_TEST_SYNC_DIRECTORY: stack.directory,
    },
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(45000),
  });
  const [output, errors, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  expect(status, errors.replaceAll(stack.auth, "[redacted]")).toBe(0);
  expect(output).toContain('.completed"');

  return output;
}

test.skipIf(process.env.CUELOOP_RUN_SYNC !== "1")(
  "a collector receives correlated standalone and native operations while an exporter outage preserves durable receipts",
  async () => {
    const collector = await createTestSyncTelemetryCollector();
    const preload = fileURLToPath(new URL("../helpers/sync-telemetry-preload.ts", import.meta.url));
    let stack: Awaited<ReturnType<typeof createTestSyncStack>> | undefined;
    let native: Awaited<ReturnType<typeof createTestSyncStack>> | undefined;
    let stackClosed = false;
    let nativeClosed = false;

    try {
      stack = await createTestSyncStack({
        cacheTraceContext: true,
        authorityPreload: preload,
        authorityEnvironment: { CUELOOP_TEST_OTLP_ENDPOINT: collector.endpoint },
      });
      await verifyTestSyncAuthorityReadiness(stack);

      for (const runtime of [process.execPath, "node"])
        await runTestSyncTelemetryConsumer(
          runtime,
          "test/helpers/sync-telemetry-consumer.ts",
          stack,
          collector.endpoint,
        );

      native = await createTestSyncStack({
        application: "thread",
        cacheTraceContext: true,
        authorityPreload: preload,
        authorityEnvironment: { CUELOOP_TEST_OTLP_ENDPOINT: collector.endpoint },
      });
      await verifyTestSyncAuthorityReadiness(native);
      await runTestSyncTelemetryConsumer(
        process.execPath,
        "test/helpers/sync-telemetry-native.ts",
        native,
        collector.endpoint,
      );
      await native.close();
      nativeClosed = true;
      let signals = { traces: "", metrics: "", logs: "" };

      await waitForTestSyncState(
        (async () => {
          for (;;) {
            try {
              signals = {
                traces: await collector.read("traces"),
                metrics: await collector.read("metrics"),
                logs: await collector.read("logs"),
              };
              const services = new Set(parseSpans(signals.traces).map((span) => span.service));

              if (
                [
                  "sync-test-bun",
                  "sync-test-node",
                  "sync-test-native",
                  "sync-test-authority",
                ].every((service) => services.has(service))
              )
                return;
            } catch {}

            await Bun.sleep(20);
          }
        })(),
        "the collector to receive all consumer services",
      );
      const spans = parseSpans(signals.traces);
      const clients = spans.filter((span) => span.name === "cueloop.sync.http.client");
      const servers = spans.filter((span) => span.name === "cueloop.sync.http.server");

      for (const service of ["sync-test-bun", "sync-test-node", "sync-test-native"])
        expect(
          clients.some(
            (client) =>
              client.service === service &&
              servers.some(
                (server) =>
                  server.traceId === client.traceId && server.parentSpanId === client.spanId,
              ),
          ),
        ).toBe(true);

      const ancestry = new Map(spans.map((span) => [`${span.traceId}:${span.spanId}`, span]));

      for (const service of ["sync-test-bun", "sync-test-node", "sync-test-native"]) {
        const operations = spans.filter(
          (span) => span.service === service && span.name === "cueloop.sync.operation.submit",
        );
        const mutations = spans.filter(
          (span) =>
            span.service === service &&
            span.name === "cueloop.sync.mutation.submit" &&
            operations.some((operation) => hasTestSyncTraceAncestor(ancestry, span, operation)),
        );
        const transports = spans.filter(
          (span) =>
            span.service === service &&
            span.name === "cueloop.sync.transport.send" &&
            mutations.some((mutation) => hasTestSyncTraceAncestor(ancestry, span, mutation)),
        );
        const commits = spans.filter((span) => span.name === "cueloop.sync.transaction.commit");

        expect(
          transports.some((transport) =>
            servers.some(
              (server) =>
                server.traceId === transport.traceId &&
                commits.some((commit) => hasTestSyncTraceAncestor(ancestry, commit, server)),
            ),
          ),
          JSON.stringify({ service, spans }),
        ).toBe(true);
      }

      expect(signals.metrics).toContain("cueloop.sync.events");
      expect(signals.logs).toContain("Sync boundary observation");
      const exported = JSON.stringify(signals);

      for (const privateValue of [
        stack.auth,
        stack.userID,
        native.auth,
        "Private telemetry test document content",
        "Private telemetry test comment body",
        "Private native telemetry",
        stack.environment.SYNC_DATABASE_URL,
      ])
        expect(exported).not.toContain(privateValue);

      await collector.stop();
      const completedDuringOutage = await runTestSyncTelemetryConsumer(
        process.execPath,
        "test/helpers/sync-telemetry-consumer.ts",
        stack,
        collector.endpoint,
      );

      expect(completedDuringOutage).toContain("sync.telemetry.export.failed");
      await stack.close();
      stackClosed = true;
    } finally {
      if (!nativeClosed) await native?.close();

      if (!stackClosed) await stack?.close();

      await collector.close();
    }
  },
);
