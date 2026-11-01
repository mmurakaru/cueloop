import { expect, test } from "bun:test";
import { validateBenchmarkPair } from "../../benchmarks/lib/benchmark-pair";

const timing = () =>
  new Map([
    ["paint_ms", 10],
    ["reads", 0],
  ]);

test("metric pairs preserve both values regardless of output order", () => {
  expect(
    validateBenchmarkPair(
      timing(),
      new Map([
        ["reads", 1],
        ["paint_ms", 7],
      ]),
    ),
  ).toEqual([
    { name: "paint_ms", baseline: 10, candidate: 7 },
    { name: "reads", baseline: 0, candidate: 1 },
  ]);
});

test("missing metrics fail in the pair where they disappear", () => {
  expect(() => validateBenchmarkPair(timing(), new Map([["paint_ms", 7]]))).toThrow();
  expect(() => validateBenchmarkPair(new Map([["paint_ms", 7]]), timing())).toThrow();
  expect(() =>
    validateBenchmarkPair(
      timing(),
      new Map([
        ["other_ms", 7],
        ["reads", 0],
      ]),
    ),
  ).toThrow();
});

test("a metric cannot disappear from both sides after the warmup", () => {
  const names = validateBenchmarkPair(timing(), timing()).map((metric) => metric.name);

  expect(() =>
    validateBenchmarkPair(new Map([["paint_ms", 10]]), new Map([["paint_ms", 7]]), names),
  ).toThrow();
});

test("invalid or unavailable timings do not produce a completed comparison", () => {
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => validateBenchmarkPair(new Map([["paint_ms", value]]), timing())).toThrow();
  }
  expect(() =>
    validateBenchmarkPair(new Map([["is_available", 0]]), new Map([["is_available", 0]])),
  ).toThrow();
});
