import { createTestSyncTelemetry } from "./sync-telemetry-setup.ts";

const endpoint = process.env.CUELOOP_TEST_OTLP_ENDPOINT;

if (!endpoint) throw new Error("Sync telemetry fixture requires a collector endpoint");

const telemetry = createTestSyncTelemetry(endpoint, "sync-test-authority");

process.once("beforeExit", () => {
  void telemetry.shutdown();
});
