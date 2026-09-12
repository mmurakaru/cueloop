/**
 * Compare two benchmark runs, base and head, row by row. A gated row fails
 * only when both the relative and the absolute growth exceed the threshold,
 * so noise on a 2 ms metric never fails a release and a 500 ms metric cannot
 * drift by 15 percent unnoticed. Rows compare on the sampler median: with the
 * three to seven cold samples a release takes, the sampler's p95 is the
 * maximum, while the median of a `*_p95_ms` row is the honest tail latency.
 *
 * Accepted regressions, with a reason and an expiry version, turn a fail into
 * an accepted row; a metric alias map keeps a renamed metric comparable.
 */

import * as v from "valibot";
import {
  formatMetricValue,
  GATE_FLOOR_MS,
  splitMetricName,
  type BenchmarkRun,
  type MetricResult,
} from "../../benchmarks/lib/result";

/** How much slower a metric may get before the gate fails it: both bounds must be exceeded. */
interface RegressionThreshold {
  /** head / base at or above which growth is material. */
  maxRegressionRatio: number;
  /** Growth below this, in the metric's unit, is never material. */
  minAbsoluteRegression: number;
}

/** Timings: 15 percent slower and at least 5 ms slower. */
export const TIMING_THRESHOLD: RegressionThreshold = {
  maxRegressionRatio: 1.15,
  minAbsoluteRegression: GATE_FLOOR_MS,
};

/** Memory: 20 percent more and at least 8 MiB more. */
export const MEMORY_THRESHOLD: RegressionThreshold = {
  maxRegressionRatio: 1.2,
  minAbsoluteRegression: 8 * 1024 * 1024,
};

/** A regression a maintainer reviewed and accepted, until the named version is released. */
const AcceptedRegressionSchema = v.object({
  /** `<script>/<metric>` */
  name: v.string(),
  /** The acceptance expires once the head version is at or above this version. */
  untilVersion: v.string(),
  reason: v.pipe(v.string(), v.minLength(1)),
});

export const AcceptedRegressionsSchema = v.array(AcceptedRegressionSchema);
/** Old metric name to current name, so a rename does not read as a missing metric. */
export const MetricAliasesSchema = v.record(v.string(), v.string());

export type AcceptedRegression = v.InferOutput<typeof AcceptedRegressionSchema>;

export type RowStatus =
  | "pass"
  | "fail"
  | "accepted"
  | "missing-base"
  | "missing-head"
  | "informational"
  | "below-floor";

export interface ComparisonRow {
  name: string;
  unit: MetricResult["unit"];
  base: number | null;
  head: number | null;
  /** head minus base, in the metric's unit; null without both sides. */
  delta: number | null;
  threshold: RegressionThreshold | null;
  status: RowStatus;
  reason?: string;
}

export interface Comparison {
  baseVersion: string | undefined;
  headVersion: string | undefined;
  rows: ComparisonRow[];
  /** True when any row is `fail` or `missing-head`. */
  failed: boolean;
}

interface CompareOptions {
  accepted?: AcceptedRegression[];
  aliases?: Record<string, string>;
}

function thresholdFor(unit: MetricResult["unit"]): RegressionThreshold | null {
  if (unit === "ms") return TIMING_THRESHOLD;
  if (unit === "bytes") return MEMORY_THRESHOLD;

  return null;
}

/** Whether head is materially slower than base under both bounds of the threshold. */
export function isMaterialRegression(
  base: number,
  head: number,
  threshold: RegressionThreshold,
): boolean {
  const growth = head - base;

  if (growth <= 0) return false;
  if (growth < threshold.minAbsoluteRegression) return false;
  if (base === 0) return true;

  return head / base >= threshold.maxRegressionRatio;
}

/** Compare version strings the way npm does; prerelease tags such as alpha.10 order after alpha.9. */
function versionAtOrAbove(version: string, floor: string): boolean {
  return Bun.semver.order(version, floor) >= 0;
}

function acceptedFor(
  name: string,
  headVersion: string | undefined,
  accepted: AcceptedRegression[],
): AcceptedRegression | undefined {
  return accepted.find(
    (entry) =>
      entry.name === name &&
      (headVersion === undefined || !versionAtOrAbove(headVersion, entry.untilVersion)),
  );
}

/** The current name of a base row, following the alias map for renamed metrics. */
function canonicalName(name: string, aliases: Record<string, string>): string {
  const { script, metric } = splitMetricName(name);
  const renamed = aliases[metric] ?? aliases[name];

  if (renamed === undefined) return name;

  return renamed.includes("/") || script === "" ? renamed : `${script}/${renamed}`;
}

export function compareRuns(
  base: BenchmarkRun,
  head: BenchmarkRun,
  options: CompareOptions = {},
): Comparison {
  const accepted = options.accepted ?? [];
  const aliases = options.aliases ?? {};
  const baseByName = new Map(
    base.results.map((result) => [canonicalName(result.name, aliases), result]),
  );
  const rows: ComparisonRow[] = [];

  for (const headRow of head.results) {
    const baseRow = baseByName.get(headRow.name);

    baseByName.delete(headRow.name);
    rows.push(compareRow(baseRow ?? null, headRow, head.packageVersion, accepted));
  }
  for (const [name, baseRow] of baseByName) {
    rows.push({
      name,
      unit: baseRow.unit,
      base: baseRow.median,
      head: null,
      delta: null,
      threshold: thresholdFor(baseRow.unit),
      status: baseRow.comparable ? "missing-head" : "informational",
    });
  }

  return {
    baseVersion: base.packageVersion,
    headVersion: head.packageVersion,
    rows,
    failed: rows.some((row) => row.status === "fail" || row.status === "missing-head"),
  };
}

function compareRow(
  baseRow: MetricResult | null,
  headRow: MetricResult,
  headVersion: string | undefined,
  accepted: AcceptedRegression[],
): ComparisonRow {
  const threshold = headRow.comparable ? thresholdFor(headRow.unit) : null;
  const row: ComparisonRow = {
    name: headRow.name,
    unit: headRow.unit,
    base: baseRow?.median ?? null,
    head: headRow.median,
    delta: baseRow ? headRow.median - baseRow.median : null,
    threshold,
    status: "informational",
  };

  if (threshold === null) return row;
  if (baseRow === null) return { ...row, status: "missing-base" };
  if (headRow.unit === "ms" && Math.max(baseRow.median, headRow.median) < GATE_FLOOR_MS) {
    return { ...row, status: "below-floor" };
  }
  if (!isMaterialRegression(baseRow.median, headRow.median, threshold)) {
    return { ...row, status: "pass" };
  }
  const acceptance = acceptedFor(headRow.name, headVersion, accepted);

  if (acceptance) return { ...row, status: "accepted", reason: acceptance.reason };

  return { ...row, status: "fail" };
}

function formatThreshold(
  threshold: RegressionThreshold | null,
  unit: MetricResult["unit"],
): string {
  if (threshold === null) return "";
  const percent = Math.round((threshold.maxRegressionRatio - 1) * 100);

  return `+${percent}% and +${formatMetricValue(threshold.minAbsoluteRegression, unit)}`;
}

/** A Markdown table for the job summary, failing rows first. */
export function formatComparisonMarkdown(comparison: Comparison): string {
  const order: Record<RowStatus, number> = {
    fail: 0,
    "missing-head": 1,
    accepted: 2,
    pass: 3,
    "missing-base": 4,
    "below-floor": 5,
    informational: 6,
  };
  const rows = comparison.rows.toSorted((left, right) => order[left.status] - order[right.status]);
  const lines = [
    `## Benchmark gate: ${comparison.failed ? "FAILED" : "passed"}`,
    "",
    `base ${comparison.baseVersion ?? "?"} vs head ${comparison.headVersion ?? "?"}, compared on the sampler median.`,
    "",
    "| metric | base | head | delta | threshold | status |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of rows) {
    const delta =
      row.delta === null || row.threshold === null
        ? "-"
        : `${row.delta >= 0 ? "+" : ""}${formatMetricValue(row.delta, row.unit)}`;
    const status = row.reason ? `${row.status} (${row.reason})` : row.status;

    lines.push(
      `| ${row.name} | ${formatMetricValue(row.base, row.unit)} | ${formatMetricValue(row.head, row.unit)} | ${delta} | ${formatThreshold(row.threshold, row.unit)} | ${status} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}
