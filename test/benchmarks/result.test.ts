/** Metric names decide unit and gating; percentiles are nearest-rank; the METRIC line format round-trips. */

import { describe, expect, test } from "bun:test";
import { formatMetricLine, parseMetricLine, timeBatchMs } from "../../benchmarks/lib/metric";
import {
  aggregateMetric,
  classifyMetric,
  formatMetricValue,
  formatRunTable,
  percentile,
} from "../../benchmarks/lib/result";

describe("classifyMetric", () => {
  test("reads unit and gating from the name suffix", () => {
    // Given the naming convention
    // Then timings and memory are gated, booleans and counts are informational
    expect(classifyMetric("render_ready_ms")).toEqual({ unit: "ms", comparable: true });
    expect(classifyMetric("after_render_heap")).toEqual({ unit: "bytes", comparable: true });
    expect(classifyMetric("after_render_rss_bytes")).toEqual({ unit: "bytes", comparable: false });
    expect(classifyMetric("is_pty_available")).toEqual({ unit: "boolean", comparable: false });
    expect(classifyMetric("patch_bytes")).toEqual({ unit: "bytes", comparable: false });
    expect(classifyMetric("files")).toEqual({ unit: "count", comparable: false });
  });
});

describe("percentile", () => {
  test("is nearest-rank and sorts for itself", () => {
    // Given five unsorted samples
    const samples = [100, 3, 1, 4, 2];

    // Then the median is the third smallest and p95 is the largest
    expect(percentile(samples, 0.5)).toBe(3);
    expect(percentile(samples, 0.95)).toBe(100);
    expect(percentile(samples, 0)).toBe(1);
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });
});

describe("aggregateMetric", () => {
  test("folds unsorted samples into a classified row keyed by script and metric", () => {
    // Given samples from three cold processes
    const row = aggregateMetric("tui-first-frame/plan_ready_cold_ms", [30, 10, 20]);

    // Then the row carries the order statistics and is gated
    expect(row).toEqual({
      name: "tui-first-frame/plan_ready_cold_ms",
      unit: "ms",
      comparable: true,
      median: 20,
      p95: 30,
      samples: [30, 10, 20],
    });
  });

  test("informational rows are not gated", () => {
    // Given a fixture count
    const row = aggregateMetric("large-stream/files", [180, 180]);

    // Then it is not compared
    expect(row.comparable).toBe(false);
  });
});

describe("metric lines", () => {
  test("format and parse round-trip, and other lines are ignored", () => {
    // Given a formatted metric line
    const line = formatMetricLine("render_ready_ms", 12.5);

    // Then it parses back and noise does not
    expect(parseMetricLine(line)).toEqual({ name: "render_ready_ms", value: 12.5 });
    expect(parseMetricLine("bench: starting")).toBeNull();
    expect(parseMetricLine("METRIC broken")).toBeNull();
    expect(parseMetricLine("METRIC x=NaN")).toBeNull();
  });
});

describe("formatting", () => {
  test("values render in their unit and the table lists every row", () => {
    // Given one timing and one memory row
    const table = formatRunTable({
      version: 1,
      generatedAt: "2026-09-12T00:00:00.000Z",
      runtime: { bunVersion: "1.3.14", platform: "darwin", arch: "arm64" },
      samplesPerBenchmark: 3,
      results: [
        aggregateMetric("a/render_ready_ms", [10, 12, 11]),
        aggregateMetric("a/tiny_ms", [0.2, 0.3]),
        aggregateMetric("a/after_render_heap", [50 * 1024 * 1024]),
      ],
    });

    // Then units, gating, and the floor warning are visible
    expect(formatMetricValue(1.234, "ms")).toBe("1.23 ms");
    expect(formatMetricValue(2 * 1024 * 1024, "bytes")).toBe("2.0 MiB");
    expect(table).toContain("a/render_ready_ms");
    expect(table).toContain("11.00 ms");
    expect(table).toContain("50.0 MiB");
    expect(table).toContain("gated");
    expect(table).toContain("below floor");
  });

  test("a batch timing covers all of its rounds", () => {
    // Given a counter as the work
    let calls = 0;

    // When timed for 25 rounds
    const elapsed = timeBatchMs(() => void (calls += 1), 25);

    // Then every round ran and the time is non-negative
    expect(calls).toBe(25);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });
});
