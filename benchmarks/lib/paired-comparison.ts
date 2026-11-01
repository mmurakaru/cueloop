import { percentile } from "./result";

/** A paired bootstrap interval compares process results without treating presses as independent runs. */
export interface PairedImprovement {
  baselineMedian: number;
  candidateMedian: number;
  improvementPercent: number;
  ratioInterval95: [number, number];
  measurable: boolean;
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
  const baselineMedian = percentile([...baseline], 0.5);
  const candidateMedian = percentile([...candidate], 0.5);
  const ratio = candidateMedian / baselineMedian;
  const bootstrapRatios: number[] = [];

  for (let sample = 0; sample < 10_000; sample++) {
    const sampledBaseline: number[] = [];
    const sampledCandidate: number[] = [];

    for (const index of Array.from({ length: baseline.length }, randomIndex)) {
      sampledBaseline.push(baseline[index]!);
      sampledCandidate.push(candidate[index]!);
    }
    bootstrapRatios.push(percentile(sampledCandidate, 0.5) / percentile(sampledBaseline, 0.5));
  }
  const sortedRatios = bootstrapRatios.toSorted((left, right) => left - right);
  const ratioInterval95: [number, number] = [sortedRatios[249]!, sortedRatios[9749]!];

  return {
    baselineMedian,
    candidateMedian,
    improvementPercent: (1 - ratio) * 100,
    ratioInterval95,
    measurable: ratio <= 0.95 && ratioInterval95[1] < 1,
  };
}
