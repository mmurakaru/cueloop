/** History records keep gated metrics only, replace a re-run commit, trim to the limit, and the log round-trips. */

import { describe, expect, test } from "bun:test";
import {
  appendHistory,
  HISTORY_LIMIT,
  parseHistory,
  serializeHistory,
} from "../../benchmarks/lib/history-record";
import { aggregateMetric, type BenchmarkRun } from "../../benchmarks/lib/result";
import { historyRecord } from "../../scripts/benchmarks/history";

function run(sha: string, metrics: Record<string, number[]>): BenchmarkRun {
  return {
    version: 1,
    generatedAt: "2026-09-12T00:00:00.000Z",
    gitSha: sha,
    packageVersion: "0.1.0-alpha.70",
    runtime: { bunVersion: "1.3.14", platform: "linux", arch: "x64" },
    samplesPerBenchmark: 3,
    results: Object.entries(metrics).map(([name, samples]) => aggregateMetric(name, samples)),
  };
}

describe("history records", () => {
  test("keep gated metrics as median and p95 and drop fixture counts", () => {
    // Given a run with a timing and a count
    const record = historyRecord(run("abc", { "a/startup_ms": [10, 30, 20], "a/files": [180] }));

    // Then only the timing is recorded
    expect(record).toEqual({
      sha: "abc",
      date: "2026-09-12T00:00:00.000Z",
      version: "0.1.0-alpha.70",
      metrics: { "a/startup_ms": [20, 30] },
    });
  });

  test("a re-run commit replaces its record and the list trims to the limit", () => {
    // Given a full history
    const existing = Array.from({ length: HISTORY_LIMIT }, (_, index) =>
      historyRecord(run(`sha${index}`, { "a/startup_ms": [index] })),
    );

    // When the newest commit runs again and a new one lands
    const rerun = appendHistory(existing, historyRecord(run("sha499", { "a/startup_ms": [1] })));
    const grown = appendHistory(rerun, historyRecord(run("new", { "a/startup_ms": [2] })));

    // Then the rerun replaced in place and the oldest record fell off
    expect(rerun).toHaveLength(HISTORY_LIMIT);
    expect(rerun.at(-1)?.metrics["a/startup_ms"]).toEqual([1, 1]);
    expect(grown).toHaveLength(HISTORY_LIMIT);
    expect(grown[0]?.sha).toBe("sha1");
    expect(grown.at(-1)?.sha).toBe("new");
  });

  test("serialize and parse round-trip, skipping lines that are not records", () => {
    // Given two records and a stray line, plus a record whose metrics are malformed
    const records = [
      historyRecord(run("a", { "a/x_ms": [1] })),
      historyRecord(run("b", { "a/x_ms": [2] })),
    ];
    const text = `${serializeHistory(records)}not json at all\n{"sha":"c","date":"d","metrics":{"m":5}}\n`;

    // Then only the well-formed records come back
    expect(parseHistory(text)).toEqual(records);
  });
});
