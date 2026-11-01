/** One metric keeps its baseline and candidate from the same process pair. */
export interface BenchmarkMetricPair {
  name: string;
  baseline: number;
  candidate: number;
}

/** Reject incomplete process pairs before any metric is appended to the experiment. */
export function validateBenchmarkPair(
  baseline: ReadonlyMap<string, number>,
  candidate: ReadonlyMap<string, number>,
  expectedNames?: readonly string[],
): BenchmarkMetricPair[] {
  const names = [...baseline.keys()].toSorted();

  if (
    baseline.size !== candidate.size ||
    (expectedNames &&
      (names.length !== expectedNames.length ||
        names.some((name, index) => name !== expectedNames[index])))
  )
    throw new Error("Benchmark process pair has a missing or unexpected metric");

  const metrics: BenchmarkMetricPair[] = [];

  for (const name of names) {
    const before = baseline.get(name);
    const after = candidate.get(name);

    if (
      before === undefined ||
      after === undefined ||
      !Number.isFinite(before) ||
      !Number.isFinite(after)
    )
      throw new Error(`Benchmark process pair has an invalid metric: ${name}`);

    if (name.endsWith("_ms") && (before <= 0 || after <= 0))
      throw new Error(`Benchmark process pair has a nonpositive timing: ${name}`);

    metrics.push({ name, baseline: before, candidate: after });
  }

  if (!metrics.some((metric) => metric.name.endsWith("_ms")))
    throw new Error("Benchmark process pair emitted no timings");

  return metrics;
}
