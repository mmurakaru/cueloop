/**
 * The release gate's comparison: both thresholds must be exceeded, accepted
 * regressions expire, renamed metrics stay comparable, a vanished gated
 * metric fails, a new one is informational, and the previous release is the
 * newest published version below head.
 */

import { describe, expect, test } from "bun:test";
import { aggregateMetric, type BenchmarkRun } from "../../benchmarks/lib/result";
import {
  compareRuns,
  formatComparisonMarkdown,
  isMaterialRegression,
  MEMORY_THRESHOLD,
  TIMING_THRESHOLD,
} from "../../scripts/benchmarks/compare";
import { previousReleaseTag } from "../../scripts/benchmarks/previous-release";

function run(version: string, metrics: Record<string, number[]>): BenchmarkRun {
  return {
    version: 1,
    generatedAt: "2026-09-12T00:00:00.000Z",
    packageVersion: version,
    runtime: { bunVersion: "1.3.14", platform: "darwin", arch: "arm64" },
    samplesPerBenchmark: 3,
    results: Object.entries(metrics).map(([name, samples]) => aggregateMetric(name, samples)),
  };
}

function statusOf(comparison: ReturnType<typeof compareRuns>, name: string) {
  return comparison.rows.find((row) => row.name === name)?.status;
}

describe("isMaterialRegression", () => {
  test("needs both the ratio and the absolute growth", () => {
    // Given the timing threshold of +15 percent and +5 ms
    // Then a big relative jump on a tiny metric passes, a tiny relative drift on a big metric passes
    expect(isMaterialRegression(1.8, 2.4, TIMING_THRESHOLD)).toBe(false);
    expect(isMaterialRegression(500, 530, TIMING_THRESHOLD)).toBe(false);
    // and a jump that clears both fails
    expect(isMaterialRegression(100, 120, TIMING_THRESHOLD)).toBe(true);
    // improvements never fail, and a zero base fails on any material growth
    expect(isMaterialRegression(100, 50, TIMING_THRESHOLD)).toBe(false);
    expect(isMaterialRegression(0, 6, TIMING_THRESHOLD)).toBe(true);
    // memory: 8 MiB and 20 percent
    expect(isMaterialRegression(40 * 1024 * 1024, 47 * 1024 * 1024, MEMORY_THRESHOLD)).toBe(false);
    expect(isMaterialRegression(40 * 1024 * 1024, 49 * 1024 * 1024, MEMORY_THRESHOLD)).toBe(true);
  });
});

describe("compareRuns", () => {
  test("classifies every row and fails on a regression or a vanished gated metric", () => {
    // Given a base and a head that regress one metric, drop one, add one, and keep a count
    const base = run("0.1.0-alpha.69", {
      "a/startup_ms": [100, 100, 100],
      "a/gone_ms": [50, 50, 50],
      "a/steady_ms": [200, 200, 200],
      "a/tiny_ms": [1, 1, 1],
      "a/files": [180],
    });
    const head = run("0.1.0-alpha.70", {
      "a/startup_ms": [130, 130, 130],
      "a/steady_ms": [205, 205, 205],
      "a/tiny_ms": [3, 3, 3],
      "a/fresh_ms": [10, 10, 10],
      "a/files": [180],
    });

    // When compared
    const comparison = compareRuns(base, head);

    // Then each row has its status and the run fails
    expect(statusOf(comparison, "a/startup_ms")).toBe("fail");
    expect(statusOf(comparison, "a/gone_ms")).toBe("missing-head");
    expect(statusOf(comparison, "a/steady_ms")).toBe("pass");
    expect(statusOf(comparison, "a/tiny_ms")).toBe("below-floor");
    expect(statusOf(comparison, "a/fresh_ms")).toBe("missing-base");
    expect(statusOf(comparison, "a/files")).toBe("informational");
    expect(comparison.failed).toBe(true);
  });

  test("an accepted regression passes until its version expires", () => {
    // Given a regression accepted until alpha.71
    const base = run("0.1.0-alpha.69", { "a/startup_ms": [100, 100, 100] });
    const accepted = [
      {
        name: "a/startup_ms",
        untilVersion: "0.1.0-alpha.71",
        reason: "new theme probe, tracked in #999",
      },
    ];

    // When head is alpha.70 and then alpha.71
    const before = compareRuns(base, run("0.1.0-alpha.70", { "a/startup_ms": [130, 130, 130] }), {
      accepted,
    });
    const expired = compareRuns(base, run("0.1.0-alpha.71", { "a/startup_ms": [130, 130, 130] }), {
      accepted,
    });

    // Then the acceptance holds for alpha.70 with its reason and lapses at alpha.71
    expect(before.rows[0]).toMatchObject({
      status: "accepted",
      reason: "new theme probe, tracked in #999",
    });
    expect(before.failed).toBe(false);
    expect(expired.rows[0]?.status).toBe("fail");
  });

  test("a renamed metric compares through the alias map", () => {
    // Given base named the metric old_ms and head names it new_ms
    const base = run("0.1.0-alpha.69", { "a/old_ms": [100, 100, 100] });
    const head = run("0.1.0-alpha.70", { "a/new_ms": [101, 101, 101] });

    // When compared with the alias
    const comparison = compareRuns(base, head, { aliases: { old_ms: "new_ms" } });

    // Then the row passes instead of reading as one missing on each side
    expect(comparison.rows).toHaveLength(1);
    expect(statusOf(comparison, "a/new_ms")).toBe("pass");
    expect(comparison.failed).toBe(false);
  });

  test("the markdown puts failures first and names the threshold", () => {
    // Given one failing and one passing row
    const comparison = compareRuns(
      run("0.1.0-alpha.69", { "a/steady_ms": [200], "a/startup_ms": [100] }),
      run("0.1.0-alpha.70", { "a/steady_ms": [201], "a/startup_ms": [130] }),
    );

    // When rendered
    const markdown = formatComparisonMarkdown(comparison);

    // Then the header says FAILED, the failing row comes first, and the threshold is spelled out
    expect(markdown).toContain("## Benchmark gate: FAILED");
    expect(markdown.indexOf("a/startup_ms")).toBeLessThan(markdown.indexOf("a/steady_ms"));
    expect(markdown).toContain("+15% and +5.00 ms");
    expect(markdown).toContain("| fail |");
  });
});

describe("previousReleaseTag", () => {
  test("picks the newest published cueloop release below head, by version", () => {
    // Given a listing with drafts, other packages, and alpha.10 above alpha.9
    const releases = [
      { tagName: "cueloop@0.1.0-alpha.11", isDraft: true },
      { tagName: "cueloop@0.1.0-alpha.9", isDraft: false },
      { tagName: "cueloop@0.1.0-alpha.10", isDraft: false },
      { tagName: "@cueloop/adapters@0.1.0-alpha.10", isDraft: false },
    ];

    // When head is alpha.11 and then alpha.9
    // Then drafts and other packages are ignored and versions order numerically
    expect(previousReleaseTag(releases, "0.1.0-alpha.11")).toBe("cueloop@0.1.0-alpha.10");
    expect(previousReleaseTag(releases, "0.1.0-alpha.9")).toBeNull();
  });
});
