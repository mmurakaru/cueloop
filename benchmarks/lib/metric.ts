/**
 * The wire between a benchmark script and the sampler: a script prints one
 * `METRIC name=value` line per measurement to stdout and nothing else the
 * sampler has to parse. The metric name's suffix decides its unit and whether
 * a release gate compares it (see result.ts), so scripts stay dumb.
 */

import { percentile } from "./result";

const METRIC_LINE_PREFIX = "METRIC ";

/** The stdout line for one measurement. */
export function formatMetricLine(name: string, value: number): string {
  return `${METRIC_LINE_PREFIX}${name}=${value}`;
}

/** Print one measurement for the sampler. `value` is a number in the unit the name implies. */
export function emitMetric(name: string, value: number): void {
  console.log(formatMetricLine(name, value));
}

/** Parse one stdout line; null when it is not a metric line. */
export function parseMetricLine(line: string): { name: string; value: number } | null {
  if (!line.startsWith(METRIC_LINE_PREFIX)) return null;
  const separator = line.indexOf("=", METRIC_LINE_PREFIX.length);

  if (separator === -1) return null;
  const name = line.slice(METRIC_LINE_PREFIX.length, separator).trim();
  const value = Number(line.slice(separator + 1).trim());

  if (!name || !Number.isFinite(value)) return null;

  return { name, value };
}

/** Wall-clock milliseconds of one synchronous call. */
export function timeMs(work: () => void): number {
  const started = performance.now();

  work();

  return performance.now() - started;
}

/** Wall-clock milliseconds of one awaited call. */
export async function timeMsAsync(work: () => Promise<void>): Promise<number> {
  const started = performance.now();

  await work();

  return performance.now() - started;
}

/**
 * Total milliseconds of `rounds` synchronous calls. A sub-millisecond
 * operation is timer noise on its own; batched to tens of milliseconds it
 * clears the gate's absolute floor and the timer's resolution.
 */
export function timeBatchMs(work: () => void, rounds: number): number {
  const started = performance.now();

  for (let round = 0; round < rounds; round++) work();

  return performance.now() - started;
}

/** Milliseconds of each of `count` awaited calls, in order. */
export async function timeRepeatedAsync(
  count: number,
  work: () => Promise<void>,
): Promise<number[]> {
  const samples: number[] = [];

  for (let index = 0; index < count; index++) samples.push(await timeMsAsync(work));

  return samples;
}

/** Emit `<prefix>_median_ms` and `<prefix>_p95_ms` for in-process latency samples. */
export function emitLatencyMetrics(prefix: string, samples: number[]): void {
  emitMetric(`${prefix}_median_ms`, percentile(samples, 0.5));
  emitMetric(`${prefix}_p95_ms`, percentile(samples, 0.95));
}

/**
 * Emit memory after a full collection. Heap in use is the retained ceiling
 * and is gated; resident set size is a process high-water mark that never
 * shrinks and includes the runtime, so it is reported for context only.
 */
export function emitMemoryMetrics(stage: string): void {
  Bun.gc(true);
  const usage = process.memoryUsage();

  emitMetric(`${stage}_heap`, usage.heapUsed);
  emitMetric(`${stage}_rss_bytes`, usage.rss);
}
