import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

for (const runtime of [process.execPath, "node"]) {
  test(`telemetry observes scheduled exporter failures before successful shutdown with ${runtime}`, async () => {
    const child = Bun.spawn(
      [runtime, fileURLToPath(new URL("./sync-telemetry-background-error.ts", import.meta.url))],
      {
        env: { ...process.env, OTEL_SDK_DISABLED: "false", OTEL_TRACES_SAMPLER: "always_on" },
        stdout: "pipe",
        stderr: "pipe",
        signal: AbortSignal.timeout(10000),
      },
    );
    const [output, errors, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(status, errors).toBe(0);
    expect(JSON.parse(output)).toEqual({
      backgroundFailureObserved: true,
      shutdownResolved: true,
    });
  }, 15000);
}
