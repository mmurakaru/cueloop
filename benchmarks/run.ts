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

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import * as v from "valibot";
import { formatRunTable, type BenchmarkRun } from "./lib/result";
import { collectSamples, foldSamples, sampleScript } from "./lib/sampler";

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

const ManifestSchema = v.object({ version: v.string() });

function gitSha(): string | undefined {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });

  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
}

async function packageVersion(): Promise<string | undefined> {
  const manifest = await Bun.file(join(import.meta.dir, "..", "packages", "cli", "package.json"))
    .json()
    .catch(() => null);
  const parsed = v.safeParse(ManifestSchema, manifest);

  return parsed.success ? parsed.output.version : undefined;
}

/** The run header every result file carries. */
export async function runHeader(
  samplesPerBenchmark: number,
): Promise<Omit<BenchmarkRun, "results">> {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    packageVersion: await packageVersion(),
    runtime: { bunVersion: Bun.version, platform: process.platform, arch: process.arch },
    samplesPerBenchmark,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      samples: { type: "string", default: String(DEFAULT_SAMPLES) },
      out: { type: "string" },
      script: { type: "string", multiple: true },
    },
  });
  const samples = Number(values.samples);

  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error("benchmark sampler: --samples must be a positive integer");
  }
  const scripts = values.script && values.script.length > 0 ? values.script : DEFAULT_SCRIPTS;
  const samplesByMetric = new Map<string, number[]>();

  for (const script of scripts) {
    console.error(`bench: ${script} x${samples}`);
    for (let sample = 0; sample < samples; sample++) {
      collectSamples(samplesByMetric, script, await sampleScript(script));
    }
  }
  const run: BenchmarkRun = {
    ...(await runHeader(samples)),
    results: foldSamples(samplesByMetric),
  };

  console.log(formatRunTable(run));
  if (values.out) {
    mkdirSync(dirname(values.out), { recursive: true });
    await Bun.write(values.out, `${JSON.stringify(run, null, 2)}\n`);
    console.error(`bench: wrote ${values.out}`);
  }
}
