/**
 * Cold-process sampling shared by the local sampler and the release gate:
 * run one benchmark script in a fresh bun process with a hermetic home and
 * collect the metrics it prints, then fold samples per metric into result
 * rows. A script that runs past the timeout is a hang and is killed.
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermeticCueloopEnvironment } from "../../test/helpers/env";
import { parseMetricLine } from "./metric";
import { aggregateMetric, type MetricResult } from "./result";

const BENCHMARKS_DIR = join(import.meta.dir, "..");

/** A script that runs longer than this is a hang, not a slow benchmark. */
const SCRIPT_TIMEOUT_MS = 5 * 60_000;

/** Run `script` in a fresh process with `bunFlags` ahead of `run`, and collect its `METRIC` lines. */
async function runScriptProcess(
  script: string,
  extraEnv: Record<string, string>,
  bunFlags: readonly string[],
): Promise<Map<string, number>> {
  const home = mkdtempSync(join(tmpdir(), "cueloop-bench-"));

  try {
    const processArguments = [
      process.execPath,
      ...bunFlags,
      "run",
      join(BENCHMARKS_DIR, `${script}.ts`),
    ];
    const benchmarkProcess = Bun.spawn(processArguments, {
      env: hermeticCueloopEnvironment(home, extraEnv),
      stdout: "pipe",
      stderr: "inherit",
      timeout: SCRIPT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    const [stdout, code] = await Promise.all([
      new Response(benchmarkProcess.stdout).text(),
      benchmarkProcess.exited,
    ]);

    if (code !== 0) {
      const timedOut = benchmarkProcess.signalCode
        ? ` (${benchmarkProcess.signalCode}, likely the ${SCRIPT_TIMEOUT_MS / 1000}s timeout)`
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

/** Run `script` once in a fresh process and return its metrics; stderr passes through. */
export function sampleScript(
  script: string,
  extraEnv: Record<string, string> = {},
): Promise<Map<string, number>> {
  return runScriptProcess(script, extraEnv, []);
}

export interface ScriptProfile {
  metrics: Map<string, number>;
  /** Absolute paths the profiler wrote: a binary profile plus a readable markdown report. */
  artifacts: string[];
}

/** "cpu" writes a `.cpuprofile`, "heap" a heap sampling report; both add a readable markdown report. */
export type ProfileKind = "cpu" | "heap";

function profileFlags(kind: ProfileKind, profileDirectory: string, name: string): string[] {
  if (kind === "heap") {
    return [
      "--heap-prof",
      "--heap-prof-md",
      `--heap-prof-dir=${profileDirectory}`,
      `--heap-prof-name=${name}`,
    ];
  }

  return [
    "--cpu-prof",
    "--cpu-prof-md",
    `--cpu-prof-dir=${profileDirectory}`,
    `--cpu-prof-name=${name}`,
  ];
}

/** A CPU run must write its binary `.cpuprofile` and a `.md` report; a heap run writes its markdown report. */
function profileComplete(kind: ProfileKind, artifacts: readonly string[]): boolean {
  if (kind === "heap") return artifacts.length > 0;

  return (
    artifacts.some((path) => path.endsWith(".cpuprofile")) &&
    artifacts.some((path) => path.endsWith(".md"))
  );
}

/** Run `script` once under Bun's `kind` profiler into a fresh dir under `outDir`; returns what landed. Needs Bun >= 1.3.0. */
export async function profileScript(
  script: string,
  outDir: string,
  kind: ProfileKind,
  extraEnv: Record<string, string> = {},
): Promise<ScriptProfile> {
  const runDir = join(outDir, `${script}-${kind}-${Date.now()}`);
  mkdirSync(runDir, { recursive: true });
  const metrics = await runScriptProcess(script, extraEnv, profileFlags(kind, runDir, script));
  const artifacts = readdirSync(runDir).map((file) => join(runDir, file));

  if (!profileComplete(kind, artifacts)) {
    throw new Error(
      `incomplete ${kind} profile in ${runDir} (got ${artifacts.length} file(s)) - Bun ${Bun.version} is below 1.3.0 or a flag was ignored`,
    );
  }

  return { metrics, artifacts };
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
