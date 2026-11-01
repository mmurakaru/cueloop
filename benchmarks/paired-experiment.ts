/** Compare one source change with its frozen revision, using identical fixtures and alternating order. */
/* eslint-disable no-await-in-loop -- Paired measurements must run sequentially. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { parseArgs } from "node:util";
import { sampleScript } from "./lib/sampler";
import { comparePairedTimings, type PairedImprovement } from "./lib/paired-comparison";
import { runHeader } from "./run";
import { validateBenchmarkPair } from "./lib/benchmark-pair";

const { values } = parseArgs({
  options: {
    "baseline-ref": { type: "string", default: "HEAD" },
    file: { type: "string", multiple: true, default: [] },
    script: { type: "string", multiple: true },
    pairs: { type: "string", default: "20" },
    out: { type: "string" },
  },
});
const pairs = Number(values.pairs);

if (!Number.isInteger(pairs) || pairs < 5 || !values.script?.length || !values.out)
  throw new Error("Benchmark experiment requires --script, --out and at least five --pairs");

if (process.env.CUELOOP_TEST_EXECUTABLE)
  throw new Error("Paired source experiments cannot replace source inside a compiled executable");

const directory = mkdtempSync(join(tmpdir(), "cueloop-experiment-"));
const replacements: Record<string, string> = {};
const baseline: Record<string, number[]> = {};
const candidate: Record<string, number[]> = {};
const preload = [`--preload=${join(import.meta.dir, "lib/source-baseline.ts")}`];
const baselineManifest = join(directory, "baseline.json");
const candidateManifest = join(directory, "candidate.json");

try {
  for (const [index, file] of values.file.entries()) {
    const source = Bun.spawnSync(["git", "show", `${values["baseline-ref"]}:${file}`]);

    if (source.exitCode !== 0) throw new Error(`Benchmark baseline source unavailable: ${file}`);

    const frozen = join(directory, `${index}.ts`);

    writeFileSync(frozen, source.stdout);
    replacements[resolve(file)] = frozen;
  }
  writeFileSync(baselineManifest, JSON.stringify(replacements));
  writeFileSync(candidateManifest, "{}");
  const measure = (script: string, original: boolean) => {
    const coverage = join(directory, "loaded-sources.ndjson");

    writeFileSync(coverage, "");

    return sampleScript(
      script,
      {
        CUELOOP_BENCH_SOURCE_BASELINE: original ? baselineManifest : candidateManifest,
        CUELOOP_BENCH_SOURCE_COVERAGE: coverage,
        CUELOOP_BENCH_PRELOAD: join(import.meta.dir, "lib/source-baseline.ts"),
      },
      preload,
    );
  };

  const header = await runHeader(pairs);
  const sourceDiff = Bun.spawnSync(["git", "diff", values["baseline-ref"], "--", ...values.file]);
  const saveProgress = (complete: boolean, comparisons: Record<string, PairedImprovement> = {}) => {
    mkdirSync(dirname(values.out!), { recursive: true });
    writeFileSync(
      values.out!,
      JSON.stringify(
        {
          ...header,
          baselineRef: values["baseline-ref"],
          files: values.file,
          sourceDiff: sourceDiff.stdout.toString(),
          complete,
          baseline,
          candidate,
          comparisons,
        },
        null,
        2,
      ) + "\n",
    );
  };

  for (const script of values.script) {
    console.error(`experiment: ${script}, warmup then ${pairs} alternating pairs`);
    const warmBaseline = await measure(script, true);
    const warmCandidate = await measure(script, false);
    const expectedNames = validateBenchmarkPair(warmBaseline, warmCandidate).map(
      (metric) => metric.name,
    );

    for (let pair = 0; pair < pairs; pair++) {
      let baselinePair: Map<string, number> | undefined;
      let candidatePair: Map<string, number> | undefined;

      for (const original of pair % 2 === 0 ? [true, false] : [false, true]) {
        const metrics = await measure(script, original);

        if (original) baselinePair = metrics;
        else candidatePair = metrics;
      }

      if (!baselinePair || !candidatePair)
        throw new Error("Benchmark process pair did not complete");

      for (const metric of validateBenchmarkPair(baselinePair, candidatePair, expectedNames)) {
        const key = `${script}/${metric.name}`;

        (baseline[key] ??= []).push(metric.baseline);
        (candidate[key] ??= []).push(metric.candidate);
      }
      saveProgress(false);
      console.error(`experiment: ${script} pair ${pair + 1}/${pairs}`);
    }
  }
  const comparisons = Object.fromEntries(
    Object.entries(baseline)
      .filter(([name]) => name.endsWith("_ms"))
      .map(([name, samples]) => {
        const headSamples = candidate[name] ?? [];

        if (samples.length !== pairs || headSamples.length !== pairs)
          throw new Error(`Benchmark process pair count is incomplete: ${name}`);

        return [name, comparePairedTimings(samples, headSamples)];
      }),
  );

  saveProgress(true, comparisons);
  console.log(JSON.stringify(comparisons, null, 2));
} finally {
  rmSync(directory, { recursive: true, force: true });
}
