import { createServer } from "node:http";
import { trace } from "@opentelemetry/api";
import * as v from "valibot";
import { createTestSyncTelemetry } from "./sync-telemetry-setup.ts";

const server = createServer((request, response) => {
  request.resume();
  // A permanent rejection isolates SDK error delivery from exporter retry timing.
  response.writeHead(400);
  response.end();
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = v.parse(v.object({ port: v.number() }), server.address());
const observed = Promise.withResolvers<void>();
const telemetry = createTestSyncTelemetry(
  `http://127.0.0.1:${address.port}`,
  "sync-test-background-error",
  () => observed.resolve(),
);
const exportFailureTimeout = setTimeout(
  () => observed.reject(new Error("Scheduled telemetry export failure was not observed")),
  3000,
);

try {
  trace.getTracer("sync-test-background-error").startSpan("sync.test.background.export").end();
  await observed.promise;
  await telemetry.shutdown();
  process.stdout.write(
    JSON.stringify({ backgroundFailureObserved: true, shutdownResolved: true }) + "\n",
  );
} finally {
  clearTimeout(exportFailureTimeout);
  await telemetry.shutdown().catch(() => {});
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
