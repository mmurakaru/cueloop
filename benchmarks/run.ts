/**
 * The benchmark sampler. Runs each benchmark script as a fresh bun process N
 * times (a cold JIT and heap per sample), collects the `METRIC name=value`
 * lines it prints, and folds them into median and p95 per metric. Prints a
 * table and, with --out, writes the JSON a release gate can compare.
 *
 *   bun run bench
 *   bun run bench -- --samples 5 --out benchmarks/results/local.json
 *   bun run bench -- --script artifact-parse --script daemon-roundtrip
 *   CUELOOP_TEST_EXECUTABLE=packages/cli/dist/cueloop bun run bench
 */

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as v from "valibot";
import { hermeticCueloopEnvironment } from "../test/helpers/env";
import { parseMetricLine } from "./lib/metric";
import { aggregateMetric, formatRunTable, type BenchmarkRun } from "./lib/result";

/** The default suite, in run order. */
const DEFAULT_SCRIPTS = [
  "binary-startup",
  "artifact-parse",
  "daemon-roundtrip",
  "tui-first-frame",
  "interaction-latency",
  "large-stream",
  "non-ascii-stream",
];

const DEFAULT_SAMPLES = 3;
/** A script that runs longer than this is a hang, not a slow benchmark. */
const SCRIPT_TIMEOUT_MS = 5 * 60_000;

interface SamplerOptions {
  samples: number;
  out: string | null;
  scripts: string[];
}

function parseSamplerArgs(argv: string[]): SamplerOptions {
  const options: SamplerOptions = { samples: DEFAULT_SAMPLES, out: null, scripts: [] };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const next = () => {
      const value = argv[index + 1];

      if (value === undefined) throw new Error(`benchmark sampler: ${argument} needs a value`);
      index += 1;

      return value;
    };

    if (argument === "--samples") options.samples = Number(next());
    else if (argument === "--out") options.out = next();
    else if (argument === "--script") options.scripts.push(next());
    else throw new Error(`benchmark sampler: unknown argument ${argument}`);
  }
  if (!Number.isInteger(options.samples) || options.samples < 1) {
    throw new Error("benchmark sampler: --samples must be a positive integer");
  }
  if (options.scripts.length === 0) options.scripts = DEFAULT_SCRIPTS;

  return options;
}

/** Run one script once in a fresh process and return its metrics; stderr passes through. */
async function sampleScript(script: string): Promise<Map<string, number>> {
  const home = mkdtempSync(join(tmpdir(), "cueloop-bench-"));
  const env = hermeticCueloopEnvironment(home);

  try {
    const proc = Bun.spawn([process.execPath, "run", join(import.meta.dir, `${script}.ts`)], {
      env,
      stdout: "pipe",
      stderr: "inherit",
      timeout: SCRIPT_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    if (code !== 0) {
      throw new Error(
        `benchmark ${script} exited with code ${code}${proc.signalCode ? ` (${proc.signalCode}, likely the ${SCRIPT_TIMEOUT_MS / 1000}s timeout)` : ""}`,
      );
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

function gitSha(): string | undefined {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });

  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}

const ManifestSchema = v.object({ version: v.string() });

async function packageVersion(): Promise<string | undefined> {
  const manifest = await Bun.file(join(import.meta.dir, "..", "packages", "cli", "package.json"))
    .json()
    .catch(() => null);
  const parsed = v.safeParse(ManifestSchema, manifest);

  return parsed.success ? parsed.output.version : undefined;
}

async function runBenchmarks(options: SamplerOptions): Promise<BenchmarkRun> {
  const samplesByMetric = new Map<string, number[]>();

  for (const script of options.scripts) {
    console.error(`bench: ${script} x${options.samples}`);
    for (let sample = 0; sample < options.samples; sample++) {
      const metrics = await sampleScript(script);

      for (const [name, value] of metrics) {
        const key = `${script}/${name}`;
        const samples = samplesByMetric.get(key) ?? [];

        samples.push(value);
        samplesByMetric.set(key, samples);
      }
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    packageVersion: await packageVersion(),
    runtime: { bunVersion: Bun.version, platform: process.platform, arch: process.arch },
    samplesPerBenchmark: options.samples,
    results: [...samplesByMetric].map(([name, samples]) => aggregateMetric(name, samples)),
  };
}

if (import.meta.main) {
  const options = parseSamplerArgs(process.argv.slice(2));
  const run = await runBenchmarks(options);

  console.log(formatRunTable(run));
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    await Bun.write(options.out, `${JSON.stringify(run, null, 2)}\n`);
    console.error(`bench: wrote ${options.out}`);
  }
}
