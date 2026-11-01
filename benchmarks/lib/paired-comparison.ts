/** A paired bootstrap interval compares process results without treating presses as independent runs. */
export interface PairedImprovement {
  baselineMedian: number;
  candidateMedian: number;
  improvementPercent: number;
  ratioInterval95: [number, number];
  measurable: boolean;
}

function medianSample(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);

  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Compare positive paired timings; a retained gain needs 5 percent and an interval below one. */
export function comparePairedTimings(
  baseline: readonly number[],
  candidate: readonly number[],
): PairedImprovement {
  if (baseline.length !== candidate.length || baseline.length < 5)
    throw new Error("Paired benchmark requires at least five complete process pairs");

  if ([...baseline, ...candidate].some((value) => !Number.isFinite(value) || value <= 0))
    throw new Error("Paired benchmark timings must be finite and positive");

  let seed = 741_103;
  const randomIndex = () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;

    return Math.floor((seed / 0x1_0000_0000) * baseline.length);
  };
  const baselineMedian = medianSample(baseline);
  const candidateMedian = medianSample(candidate);
  const ratio = candidateMedian / baselineMedian;
  const bootstrapRatios: number[] = [];

  for (let sample = 0; sample < 10_000; sample++) {
    const sampledBaseline: number[] = [];
    const sampledCandidate: number[] = [];

    for (const index of Array.from({ length: baseline.length }, randomIndex)) {
      sampledBaseline.push(baseline[index]!);
      sampledCandidate.push(candidate[index]!);
    }
    bootstrapRatios.push(medianSample(sampledCandidate) / medianSample(sampledBaseline));
  }
  bootstrapRatios.sort((left, right) => left - right);
  const ratioInterval95: [number, number] = [bootstrapRatios[249]!, bootstrapRatios[9749]!];

  return {
    baselineMedian,
    candidateMedian,
    improvementPercent: (1 - ratio) * 100,
    ratioInterval95,
    measurable: ratio <= 0.95 && ratioInterval95[1] < 1,
  };
}
