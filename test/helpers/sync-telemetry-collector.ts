import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const COLLECTOR_IMAGE =
  "otel/opentelemetry-collector-contrib@sha256:e40d61f10c9a617cca1ffd1be4d7e2b3a4b0f0001798ff07e58cabe82e618cea";

async function runTestSyncCollectorDocker(arguments_: string[]) {
  const child = Bun.spawn(["docker", ...arguments_], {
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(60000),
  });
  const [output, error, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (status !== 0) throw new Error(`Sync collector Docker command failed: ${error}`);

  return output.trim();
}

export async function createTestSyncTelemetryCollector() {
  const directory = mkdtempSync(join(tmpdir(), "cueloop-otel-collector-"));
  const name = `cueloop-sync-otel-${randomUUID()}`;
  const configuration = join(directory, "collector.yaml");
  const outputDirectory = join(directory, "output");

  mkdirSync(outputDirectory);
  // The collector uses UID 10001 inside this private temporary directory.
  chmodSync(outputDirectory, 0o777);
  const close = async () => {
    await runTestSyncCollectorDocker(["rm", "--force", name]).catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  };

  writeFileSync(
    configuration,
    `
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  file/traces:
    path: /telemetry/traces.json
    format: json
    flush_interval: 100ms
  file/metrics:
    path: /telemetry/metrics.json
    format: json
    flush_interval: 100ms
  file/logs:
    path: /telemetry/logs.json
    format: json
    flush_interval: 100ms
extensions:
  health_check:
    endpoint: 0.0.0.0:13133
service:
  extensions: [health_check]
  telemetry:
    logs:
      level: error
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [file/traces]
    metrics:
      receivers: [otlp]
      exporters: [file/metrics]
    logs:
      receivers: [otlp]
      exporters: [file/logs]
`,
    { mode: 0o644 },
  );

  try {
    await runTestSyncCollectorDocker([
      "create",
      "--name",
      name,
      "--mount",
      `type=bind,source=${outputDirectory},target=/telemetry`,
      "--publish",
      "127.0.0.1::4318",
      "--publish",
      "127.0.0.1::13133",
      COLLECTOR_IMAGE,
      "--config=/etc/otelcol-contrib/config.yaml",
    ]);
    await runTestSyncCollectorDocker([
      "cp",
      configuration,
      `${name}:/etc/otelcol-contrib/config.yaml`,
    ]);
    await runTestSyncCollectorDocker(["start", name]);
    const port = await runTestSyncCollectorDocker([
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "4318/tcp") 0).HostPort}}',
      name,
    ]);
    const health = await runTestSyncCollectorDocker([
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "13133/tcp") 0).HostPort}}',
      name,
    ]);
    const deadline = Date.now() + 10000;

    for (;;) {
      try {
        const response = await fetch(`http://127.0.0.1:${health}/`, {
          signal: AbortSignal.timeout(1000),
        });

        if (response.ok) break;
      } catch {}

      if (Date.now() >= deadline)
        throw new Error("Sync collector health endpoint did not become available");

      await Bun.sleep(20);
    }

    return {
      endpoint: `http://127.0.0.1:${port}`,
      async read(signal: "traces" | "metrics" | "logs"): Promise<string> {
        return readFileSync(join(outputDirectory, `${signal}.json`), "utf8");
      },
      diagnostics: () => runTestSyncCollectorDocker(["logs", name]),
      stop: () => runTestSyncCollectorDocker(["stop", "--time", "2", name]),
      close,
    };
  } catch (cause) {
    await close();

    throw cause;
  }
}
