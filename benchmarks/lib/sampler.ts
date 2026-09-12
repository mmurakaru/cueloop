/**
 * Cold-process sampling shared by the local sampler and the release gate:
 * run one benchmark script in a fresh bun process with a hermetic home and
 * collect the metrics it prints, then fold samples per metric into result
 * rows. A script that runs past the timeout is a hang and is killed.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermeticCueloopEnvironment } from "../../test/helpers/env";
import { parseMetricLine } from "./metric";
import { aggregateMetric, type MetricResult } from "./result";

const BENCHMARKS_DIR = join(import.meta.dir, "..");

/** A script that runs longer than this is a hang, not a slow benchmark. */
const SCRIPT_TIMEOUT_MS = 5 * 60_000;

/** Run `script` once in a fresh process and return its metrics; stderr passes through. */
export async function sampleScript(
  script: string,
  extraEnv: Record<string, string> = {},
): Promise<Map<string, number>> {
  const home = mkdtempSync(join(tmpdir(), "cueloop-bench-"));

  try {
    const proc = Bun.spawn([process.execPath, "run", join(BENCHMARKS_DIR, `${script}.ts`)], {
      env: hermeticCueloopEnvironment(home, extraEnv),
      stdout: "pipe",
      stderr: "inherit",
      timeout: SCRIPT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    if (code !== 0) {
      const timedOut = proc.signalCode
        ? ` (${proc.signalCode}, likely the ${SCRIPT_TIMEOUT_MS / 1000}s timeout)`
        : "";

      throw new Error(`benchmark ${script} exited with code ${code}${timedOut}`);
    }
    const metrics = new Map<string, number>();

    for (const line of stdout.split("\n")) {
      const metric = parseMetricLine(line);

      if (metric) metrics.set(metric.name, metric.value);
    }

    return metrics;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** Append one sample run's metrics into the per-metric sample lists, keyed `<script>/<metric>`. */
export function collectSamples(
  into: Map<string, number[]>,
  script: string,
  metrics: Map<string, number>,
): void {
  for (const [name, value] of metrics) {
    const key = `${script}/${name}`;
    const samples = into.get(key) ?? [];

    samples.push(value);
    into.set(key, samples);
  }
}

/** Fold per-metric sample lists into result rows. */
export function foldSamples(samplesByMetric: Map<string, number[]>): MetricResult[] {
  return [...samplesByMetric].map(([name, samples]) => aggregateMetric(name, samples));
}
