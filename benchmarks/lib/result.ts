/**
 * Benchmark results: per-metric samples with median and p95, classified by the
 * metric name so a release gate knows what to compare. Timings end in `_ms`,
 * retained memory in `_heap`, booleans start with `is_`, and everything else
 * is an informational count or byte size that describes the fixture. The
 * gate's thresholds live with the gate, not in the data.
 */

import * as v from "valibot";

export type MetricUnit = "ms" | "bytes" | "count" | "boolean";

interface MetricClassification {
  unit: MetricUnit;
  /** Whether a gate compares this metric between two runs. */
  comparable: boolean;
}

/**
 * Below this many milliseconds a gated timing cannot fail the gate's absolute
 * floor; the table flags such rows so a script batches its work instead.
 */
export const GATE_FLOOR_MS = 5;

/** Unit and gating of a metric from its name alone. */
export function classifyMetric(name: string): MetricClassification {
  if (name.endsWith("_ms")) return { unit: "ms", comparable: true };
  if (name.endsWith("_heap")) return { unit: "bytes", comparable: true };
  if (name.startsWith("is_")) return { unit: "boolean", comparable: false };
  if (name.endsWith("_bytes")) return { unit: "bytes", comparable: false };

  return { unit: "count", comparable: false };
}

/** Nearest-rank percentile of `samples` (any order); `fraction` in [0, 1]. NaN for no samples. */
export function percentile(samples: number[], fraction: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = samples.toSorted((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);

  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

const MetricResultSchema = v.object({
  /** `<script>/<metric>` */
  name: v.string(),
  unit: v.picklist(["ms", "bytes", "count", "boolean"]),
  samples: v.array(v.number()),
  median: v.number(),
  p95: v.number(),
  comparable: v.boolean(),
});

export const BenchmarkRunSchema = v.object({
  version: v.literal(1),
  generatedAt: v.string(),
  gitSha: v.optional(v.string()),
  packageVersion: v.optional(v.string()),
  runtime: v.object({ bunVersion: v.string(), platform: v.string(), arch: v.string() }),
  samplesPerBenchmark: v.pipe(v.number(), v.integer(), v.minValue(1)),
  results: v.array(MetricResultSchema),
});

export type MetricResult = v.InferOutput<typeof MetricResultSchema>;
export type BenchmarkRun = v.InferOutput<typeof BenchmarkRunSchema>;

/** Fold the samples of one metric into its result row. */
export function aggregateMetric(name: string, samples: number[]): MetricResult {
  const classification = classifyMetric(splitMetricName(name).metric);

  return {
    name,
    unit: classification.unit,
    samples,
    median: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    comparable: classification.comparable,
  };
}

/** `<script>/<metric>` split; a bare name has an empty script. */
export function splitMetricName(name: string): { script: string; metric: string } {
  const slash = name.indexOf("/");

  return slash === -1
    ? { script: "", metric: name }
    : { script: name.slice(0, slash), metric: name.slice(slash + 1) };
}

/** A value in its unit for a table: ms with two decimals, bytes as MiB, counts as is; "-" for none. */
export function formatMetricValue(value: number | null, unit: MetricUnit): string {
  if (value === null || Number.isNaN(value)) return "-";
  if (unit === "ms") return `${value.toFixed(2)} ms`;
  if (unit === "bytes") return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  if (unit === "boolean") return value ? "yes" : "no";

  return String(value);
}

/** How a row relates to the gate: compared, compared but too small to ever fail, or context only. */
function gateNote(result: MetricResult): string {
  if (!result.comparable) return "";
  if (result.unit === "ms" && result.median < GATE_FLOOR_MS) return "below floor";

  return "gated";
}

/** A plain-text table of every result: name, median, p95, samples, gate note. */
export function formatRunTable(run: BenchmarkRun): string {
  const rows = run.results.map((result) => [
    result.name,
    formatMetricValue(result.median, result.unit),
    formatMetricValue(result.p95, result.unit),
    String(result.samples.length),
    gateNote(result),
  ]);
  const header = ["metric", "median", "p95", "n", ""];
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column]!.length)),
  );
  const line = (row: string[]) =>
    row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ");

  return [line(header), ...rows.map(line)].join("\n");
}
