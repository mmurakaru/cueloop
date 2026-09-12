/**
 * The install-vm host's pure logic: version derivation and the aggregation of
 * guest assertion files into a verdict. The VM boot itself needs KVM and is
 * exercised by install-vm.yml, not here.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregate, fixtureVersions } from "./runner";

describe("install-vm runner", () => {
  test("derives fixture version tags from the target", () => {
    const versions = fixtureVersions("0.1.0-alpha.70", "0.1.0-alpha.69");

    expect(versions).toEqual({
      good: "0.1.0-alpha.70",
      previous: "0.1.0-alpha.69",
      badChecksum: "0.1.0-alpha.70-badchecksum",
      truncated: "0.1.0-alpha.70-truncated",
      missingAsset: "0.1.0-alpha.70-missingasset",
    });
  });

  test("aggregates guest assertions into a verdict", () => {
    const runsDir = mkdtempSync(join(tmpdir(), "install-vm-runs-"));

    try {
      mkdirSync(join(runsDir, "clean-machine"), { recursive: true });
      writeFileSync(
        join(runsDir, "clean-machine", "assertions.tsv"),
        "clean-exit\tpass\t\nclean-version\tpass\t\n",
      );
      mkdirSync(join(runsDir, "upgrade"), { recursive: true });
      writeFileSync(join(runsDir, "upgrade", "assertions.tsv"), "upgrade-exit\tfail\tboom\n");

      const specs = [
        { name: "clean-machine", description: "clean" },
        { name: "upgrade", description: "upgrade" },
        { name: "home-unset", description: "missing run" },
      ];
      const result = aggregate(runsDir, specs, "linux-x64");

      expect(result.scenarios.map((scenario) => [scenario.name, scenario.passed])).toEqual([
        ["clean-machine", true],
        ["upgrade", false],
        ["home-unset", false],
      ]);
      expect(result.passed).toBe(false);
      expect(result.platform).toBe("linux-x64");
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
});
