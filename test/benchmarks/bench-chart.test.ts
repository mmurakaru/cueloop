/** The trend chart geometry: one line per metric, points only where a record has the metric, ticks span the max. */

import { describe, expect, test } from "bun:test";
import type { HistoryRecord } from "../../benchmarks/lib/history-record";
import { buildChart, formatChartValue } from "../../site/src/bench-chart";

function record(sha: string, metrics: Record<string, [number, number]>): HistoryRecord {
  return { sha, date: "2026-09-12T00:00:00.000Z", metrics };
}

describe("buildChart", () => {
  test("draws a line per metric and marks its last value", () => {
    // Given three pushes where one metric appears only in the last two
    const records = [
      record("a", { "x/startup_ms": [10, 12] }),
      record("b", { "x/startup_ms": [20, 22], "x/late_ms": [5, 5] }),
      record("c", { "x/startup_ms": [30, 33], "x/late_ms": [7, 7] }),
    ];

    // When charted
    const chart = buildChart(records, ["x/startup_ms", "x/late_ms", "x/absent_ms"]);

    // Then each present metric has a path and its last value, the absent one is empty
    const startup = chart.lines.find((line) => line.metric === "x/startup_ms");
    const late = chart.lines.find((line) => line.metric === "x/late_ms");
    const absent = chart.lines.find((line) => line.metric === "x/absent_ms");

    expect(startup?.last).toBe(30);
    expect(startup?.path.startsWith("M")).toBe(true);
    expect(late?.last).toBe(7);
    expect(absent).toMatchObject({ last: null, path: "" });
    // three ticks from zero to the padded max, which is above the largest median
    expect(chart.ticks).toHaveLength(3);
    expect(chart.ticks[0]?.value).toBe(0);
    expect(chart.ticks[2]?.value).toBeGreaterThan(30);
  });

  test("renders values in their unit", () => {
    // Then ms and bytes read as a person expects
    expect(formatChartValue(120.4, "ms")).toBe("120 ms");
    expect(formatChartValue(50 * 1024 * 1024, "bytes")).toBe("50 MiB");
  });
});
