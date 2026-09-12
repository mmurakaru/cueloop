/**
 * The pull request benchmark comment: measure the merge-base source tree and
 * the head source tree on the same runner, interleaved, with the scripts that
 * need no binary, and render the comparison as Markdown that never fails the
 * job. Each tree runs its own copy of the sampler, so a tree from before the
 * benchmark suite existed simply has no base rows.
 *
 *   bun run scripts/benchmarks/pr-compare.ts --base-dir ../base --head-dir . \
 *     --base-sha abc1234 --head-sha def5678 --samples 3 \
 *     --out dist/bench-pr.json --markdown dist/bench-pr.md
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import * as v from "valibot";
import {
  BenchmarkRunSchema,
  formatMetricValue,
  GATE_FLOOR_MS,
  splitMetricName,
  type BenchmarkRun,
} from "../../benchmarks/lib/result";
import { collectSamples, foldSamples } from "../../benchmarks/lib/sampler";
import { runHeader, SOURCE_SCRIPTS } from "../../benchmarks/run";
import { compareRuns, formatComparisonMarkdown, type Comparison } from "./compare";

/** The HTML marker the sticky comment is found and replaced by. */
const PR_COMMENT_MARKER = "<!-- cueloop-bench -->";

interface Tree {
  directory: string;
  sha: string;
}

interface PrCompareOptions {
  base: Tree;
  head: Tree;
  samples: number;
  out: string;
  markdown: string;
}

function parsePrArgs(argv: string[]): PrCompareOptions {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      "base-dir": { type: "string" },
      "head-dir": { type: "string" },
      "base-sha": { type: "string" },
      "head-sha": { type: "string" },
      samples: { type: "string", default: "3" },
      out: { type: "string" },
      markdown: { type: "string" },
    },
  });
  const required = (
    name: "base-dir" | "head-dir" | "base-sha" | "head-sha" | "out" | "markdown",
  ): string => {
    const value = values[name];

    if (!value) throw new Error(`pr-compare: --${name} is required`);

    return value;
  };
  const samples = Number(values.samples);

  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error("pr-compare: --samples must be a positive integer");
  }

  return {
    base: { directory: required("base-dir"), sha: required("base-sha") },
    head: { directory: required("head-dir"), sha: required("head-sha") },
    samples,
    out: required("out"),
    markdown: required("markdown"),
  };
}

/** Whether a tree carries the benchmark suite at all; older merge bases do not. */
function hasBenchmarks(tree: Tree): boolean {
  return existsSync(join(tree.directory, "benchmarks", "run.ts"));
}

/** One cold sample of `script` from a tree's own sampler; its metrics, keyed by bare metric name. */
async function sampleTree(
  tree: Tree,
  script: string,
  scratch: string,
): Promise<Map<string, number>> {
  const out = join(scratch, `${tree.sha}-${script}-${Date.now()}.json`);
  const proc = Bun.spawn(
    ["bun", "run", "benchmarks/run.ts", "--samples", "1", "--script", script, "--out", out],
    { cwd: tree.directory, stdout: "ignore", stderr: "inherit" },
  );

  if ((await proc.exited) !== 0) {
    throw new Error(`pr-compare: ${script} failed in ${tree.directory}`);
  }
  const run = v.parse(BenchmarkRunSchema, await Bun.file(out).json());

  return new Map(
    run.results.map((result) => [splitMetricName(result.name).metric, result.samples[0]!]),
  );
}

async function measureTrees(
  options: PrCompareOptions,
  scratch: string,
): Promise<{ base: BenchmarkRun; head: BenchmarkRun }> {
  const baseSamples = new Map<string, number[]>();
  const headSamples = new Map<string, number[]>();
  const baseAvailable = hasBenchmarks(options.base);

  for (const script of SOURCE_SCRIPTS) {
    for (let sample = 0; sample < options.samples; sample++) {
      const headFirst = sample % 2 === 0;
      const order: ("head" | "base")[] = headFirst ? ["head", "base"] : ["base", "head"];

      for (const side of order) {
        if (side === "base" && !baseAvailable) continue;
        console.error(`pr-compare: ${script} sample ${sample + 1}/${options.samples} ${side}`);
        const tree = side === "head" ? options.head : options.base;
        const into = side === "head" ? headSamples : baseSamples;

        collectSamples(into, script, await sampleTree(tree, script, scratch));
      }
    }
  }
  const header = await runHeader(options.samples);

  return {
    base: { ...header, gitSha: options.base.sha, results: foldSamples(baseSamples) },
    head: { ...header, gitSha: options.head.sha, results: foldSamples(headSamples) },
  };
}

/** The comment body: a title that does not read as a gate, the table, and the caveats a reader needs. */
export function formatPrComment(comparison: Comparison, base: Tree, head: Tree): string {
  const attention = comparison.rows.filter(
    (row) => row.status === "fail" || row.status === "missing-head",
  );
  // an absent base shows up as every row missing its base side
  const baseMissing =
    comparison.rows.length > 0 && comparison.rows.every((row) => row.status === "missing-base");
  const title =
    attention.length > 0
      ? `## Benchmarks: ${attention.length} row${attention.length === 1 ? "" : "s"} worth a look`
      : "## Benchmarks: no material change";
  const table = formatComparisonMarkdown(comparison, {
    title,
    subtitle: `merge base \`${base.sha.slice(0, 7)}\` vs head \`${head.sha.slice(0, 7)}\`, source only, compared on the sampler median; informational, never blocks a merge.`,
  });
  const notes = [
    baseMissing
      ? "The merge base predates the benchmark suite, so there is nothing to compare against yet."
      : null,
    `Rows marked \`fail\` exceed the release gate's thresholds (timings +15% and +${formatMetricValue(GATE_FLOOR_MS, "ms")}, memory +20% and +8.0 MiB) on a shared runner; rerun before trusting a single sample.`,
  ].filter((note) => note !== null);

  return `${PR_COMMENT_MARKER}\n${table}\n${notes.map((note) => `${note}\n`).join("\n")}`;
}

if (import.meta.main) {
  const options = parsePrArgs(process.argv.slice(2));
  const scratch = mkdtempSync(join(tmpdir(), "cueloop-pr-bench-"));

  try {
    const { base, head } = await measureTrees(options, scratch);
    const comparison = compareRuns(base, head);
    const body = formatPrComment(comparison, options.base, options.head);

    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify({ base, head, comparison }, null, 2)}\n`);
    mkdirSync(dirname(options.markdown), { recursive: true });
    writeFileSync(options.markdown, body);
    console.log(body);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
