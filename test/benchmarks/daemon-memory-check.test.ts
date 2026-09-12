/** The leak check fits a least-squares slope and fails only when growth or slope exceeds the ceilings. */

import { describe, expect, test } from "bun:test";
import { fitSlope, judgeHeapSamples } from "../../scripts/benchmarks/daemon-memory-check";

describe("daemon leak fit", () => {
  test("fits a slope and judges growth against the ceilings", () => {
    // Given a flat series and one that climbs 2 MiB per cycle
    const flat = Array.from({ length: 50 }, (_, index) => 40e6 + (index % 3) * 1000);
    const steep = Array.from({ length: 50 }, (_, index) => 40e6 + index * 2 * 1024 * 1024);

    // Then the flat series is fine and the steep one leaks by slope
    expect(Math.abs(fitSlope(flat))).toBeLessThan(1024);
    expect(fitSlope([1, 2, 3, 4])).toBeCloseTo(1);
    expect(judgeHeapSamples(flat).leaking).toBe(false);
    expect(judgeHeapSamples(steep)).toMatchObject({ leaking: true });
    expect(judgeHeapSamples(steep).slopeBytesPerCycle).toBeCloseTo(2 * 1024 * 1024, -2);
  });

  test("a slow drift over the total ceiling fails even at a gentle slope", () => {
    // Given a series that ends 30 MiB above where it started, above the 24 MiB total ceiling
    const drift = Array.from(
      { length: 50 },
      (_, index) => 40e6 + (index * (30 * 1024 * 1024)) / 49,
    );

    // Then it is flagged
    expect(judgeHeapSamples(drift).leaking).toBe(true);
  });
});
