import { expect, test } from "bun:test";
import { comparePairedTimings } from "../../benchmarks/lib/paired-comparison";

test("a consistent improvement clears the paired interval and minimum gain", () => {
  const result = comparePairedTimings([100, 100, 100, 100, 100], [70, 70, 70, 70, 70]);

  expect(result.improvementPercent).toBeCloseTo(30);
  expect(result.ratioInterval95).toEqual([0.7, 0.7]);
  expect(result.measurable).toBe(true);
});

test("paired estimates use the same nearest-rank median as the existing sampler", () => {
  const result = comparePairedTimings([100, 110, 120, 130, 140, 150], [50, 60, 70, 80, 90, 100]);

  expect(result.baselineMedian).toBe(120);
  expect(result.candidateMedian).toBe(70);
});

test("unchanged, slower and small improvements are not retained", () => {
  for (const candidate of [100, 120, 97]) {
    expect(
      comparePairedTimings(
        [100, 100, 100, 100, 100],
        Array.from({ length: 5 }, () => candidate),
      ).measurable,
    ).toBe(false);
  }
});

test("incomplete and invalid pairs fail instead of producing confidence", () => {
  expect(() => comparePairedTimings([1], [1])).toThrow();
  expect(() => comparePairedTimings([1, 1, 1, 1, 1], [1, 1, 1, 1, 0])).toThrow();
});
