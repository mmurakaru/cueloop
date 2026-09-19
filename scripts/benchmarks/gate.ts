/**
 * The release benchmark gate: measure the previous published binary and the
 * fresh one on the same runner, interleaved, so runner load falls on both
 * sides equally, then compare the runs and fail on a material regression. A
 * failing comparison is confirmed by a second independent pass before it
 * counts, which squares the false-alarm rate on a shared runner. Writes the
 * comparison as JSON and, with --summary, as a Markdown table.
 *
 *   bun run scripts/benchmarks/gate.ts --target darwin-arm64 \
 *     --head dist/head/cueloop-darwin-arm64 --head-version 0.1.0-alpha.70 \
 *     --out dist/benchmark-darwin-arm64.json --summary "$GITHUB_STEP_SUMMARY"
 *
 * A base binary that fails to run degrades to a run without a base (every
 * row missing-base, said loudly), because an old binary against today's
 * fixtures is not a regression of the head. A head failure fails the gate.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import * as v from "valibot";
import type { BenchmarkRun } from "../../benchmarks/lib/result";
import { collectSamples, foldSamples, sampleScript } from "../../benchmarks/lib/sampler";
import { runHeader } from "../../benchmarks/run";
import {
  AcceptedRegressionsSchema,
  compareRuns,
  formatComparisonMarkdown,
  MetricAliasesSchema,
  type Comparison,
} from "./compare";
import { RELEASE_TAG_PREFIX, resolvePreviousReleaseTag } from "./previous-release";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const ACCEPTED_REGRESSIONS = join(REPO_ROOT, "benchmarks", "accepted-regressions.json");
const METRIC_ALIASES = join(REPO_ROOT, "benchmarks", "metric-aliases.json");

/** The first version whose binary writes the ready file the first-frame benchmark waits for. */
const READY_SIGNAL_SINCE = "0.1.0-alpha.69";

/**
 * The scripts whose numbers depend on the binary under test, with how many
 * cold samples each side gets: startup is cheap and jittery, so it gets
 * many; a first frame is seconds each, so fewer.
 */
const BINARY_SCRIPTS: { script: string; samples: number }[] = [
  { script: "binary-startup", samples: 15 },
  { script: "tui-first-frame", samples: 5 },
];

interface Side {
  binary: string;
  version: string;
}

interface GateOptions {
  target: string;
  head: Side;
  out: string;
  summary: string | null;
  /** When set, a regression is recorded and accepted instead of failing the gate. */
  acceptReason: string | null;
}

interface Measurement {
  head: Map<string, number[]>;
  /** Null when the base binary failed to run. */
  base: Map<string, number[]> | null;
  baseError: string | null;
}

interface GateOutcome {
  comparison: Comparison;
  baseError: string | null;
  runs: { head: BenchmarkRun; base: BenchmarkRun };
}

function parseGateArgs(argv: string[]): GateOptions {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      target: { type: "string" },
      head: { type: "string" },
      "head-version": { type: "string" },
      out: { type: "string" },
      summary: { type: "string" },
      "accept-reason": { type: "string" },
    },
  });
  const required = (name: "target" | "head" | "head-version" | "out"): string => {
    const value = values[name];

    if (!value) throw new Error(`benchmark gate: --${name} is required`);

    return value;
  };

  return {
    target: required("target"),
    head: { binary: required("head"), version: required("head-version") },
    out: required("out"),
    summary: values.summary ?? null,
    acceptReason: values["accept-reason"] || null,
  };
}

/** Environment the binary scripts read: which executable, and whether it writes the ready signal. */
function sideEnvironment(side: Side) {
  return {
    CUELOOP_TEST_EXECUTABLE: side.binary,
    CUELOOP_BENCH_READY_SIGNAL: Bun.semver.order(side.version, READY_SIGNAL_SINCE) >= 0 ? "1" : "0",
  };
}

/**
 * One interleaved measurement of both sides. Order alternates per sample so
 * neither side always follows the other's warm caches. A base failure ends
 * the base side only; a head failure propagates.
 */
async function measure(head: Side, base: Side): Promise<Measurement> {
  const headSamples = new Map<string, number[]>();
  const baseSamples = new Map<string, number[]>();
  let baseError: string | null = null;

  for (const { script, samples } of BINARY_SCRIPTS) {
    for (let sample = 0; sample < samples; sample++) {
      const order: Side[] = sample % 2 === 0 ? [head, base] : [base, head];

      for (const side of order) {
        if (side === base && baseError !== null) continue;
        const label = side === head ? "head" : "base";

        console.error(`gate: ${script} sample ${sample + 1}/${samples} ${label}`);
        try {
          const metrics = await sampleScript(script, sideEnvironment(side));

          collectSamples(side === head ? headSamples : baseSamples, script, metrics);
        } catch (error) {
          if (side === head) throw error;
          baseError = error instanceof Error ? error.message : String(error);
          console.error(`gate: base binary failed, comparing without a base: ${baseError}`);
        }
      }
    }
  }

  return { head: headSamples, base: baseError === null ? baseSamples : null, baseError };
}

/** Wrap one side's samples as a run; only the head was built from this checkout, so only it keeps the sha. */
async function toRun(
  samplesByMetric: Map<string, number[]>,
  version: string,
  isHead: boolean,
): Promise<BenchmarkRun> {
  const header = await runHeader(0);

  return {
    ...header,
    gitSha: isHead ? header.gitSha : undefined,
    packageVersion: version,
    results: foldSamples(samplesByMetric),
  };
}

async function compareOnce(head: Side, base: Side): Promise<GateOutcome> {
  const measured = await measure(head, base);
  const headRun = await toRun(measured.head, head.version, true);
  const baseRun = await toRun(measured.base ?? new Map(), base.version, false);
  const comparison = compareRuns(baseRun, headRun, {
    accepted: v.parse(AcceptedRegressionsSchema, await Bun.file(ACCEPTED_REGRESSIONS).json()),
    aliases: v.parse(MetricAliasesSchema, await Bun.file(METRIC_ALIASES).json()),
  });

  return { comparison, baseError: measured.baseError, runs: { head: headRun, base: baseRun } };
}

/** Download the previous release's binary for `target` into `directory` and make it executable. */
async function downloadBaseBinary(tag: string, target: string, directory: string): Promise<string> {
  const asset = `cueloop-${target}`;
  const proc = Bun.spawn(
    ["gh", "release", "download", tag, "--pattern", asset, "--dir", directory],
    { stdout: "inherit", stderr: "inherit" },
  );

  if ((await proc.exited) !== 0) {
    throw new Error(`benchmark gate: could not download ${asset} from ${tag}`);
  }
  const path = join(directory, asset);

  chmodSync(path, 0o755);

  return path;
}

/** Run the gate; true when the release may proceed. */
async function runGate(options: GateOptions): Promise<boolean> {
  const scratch = mkdtempSync(join(tmpdir(), "cueloop-gate-"));

  try {
    chmodSync(options.head.binary, 0o755);
    const baseTag = await resolvePreviousReleaseTag(options.head.version);
    const base: Side = {
      binary: await downloadBaseBinary(baseTag, options.target, scratch),
      version: baseTag.slice(RELEASE_TAG_PREFIX.length),
    };
    let outcome = await compareOnce(options.head, base);

    if (outcome.comparison.failed && options.acceptReason === null) {
      console.error("gate: regression found, confirming with a second independent pass");
      outcome = await compareOnce(options.head, base);
    }
    const { comparison, baseError, runs } = outcome;
    const accepted = comparison.failed && options.acceptReason !== null;
    const notes: string[] = [];

    if (baseError) {
      notes.push(
        `**No base measurements:** the ${base.version} binary failed to run (${baseError}).`,
      );
    }
    if (accepted) {
      notes.push(`**Regression accepted by the release operator:** ${options.acceptReason}`);
    }
    const markdown = `${formatComparisonMarkdown(comparison)}${notes.map((note) => `\n${note}\n`).join("")}`;
    const record = {
      target: options.target,
      base: runs.base,
      head: runs.head,
      comparison,
      baseError,
      acceptedReason: accepted ? options.acceptReason : null,
    };

    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(record, null, 2)}\n`);
    if (options.summary) writeFileSync(options.summary, markdown, { flag: "a" });
    console.log(markdown);

    return !comparison.failed || accepted;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  process.exit((await runGate(parseGateArgs(process.argv.slice(2)))) ? 0 : 1);
}
