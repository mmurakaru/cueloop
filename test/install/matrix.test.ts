/**
 * The install-matrix host end to end: build an offline release tree, run the
 * scenario scripts against it through run.ts, and check the aggregate verdict.
 * Proves the harness passes a clean release and, just as important, fails a
 * broken one, so a green matrix in CI means something. No network, no real
 * binary; the served asset is the shared stand-in script.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checksumsText, RELEASE_ASSETS, testBinaryScript } from "../helpers/install-fixtures";
import { runMatrix } from "./matrix/run";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const INSTALLER = join(REPO_ROOT, "site", "public", "install.sh");
const TAG_PREFIX = "cueloop@";

/** Write one release: the stand-in binary for every asset plus a checksums.txt. */
function writeRelease(assetsDir: string, version: string, corruptChecksums: boolean): void {
  const releaseDir = join(assetsDir, `${TAG_PREFIX}${version}`);

  mkdirSync(releaseDir, { recursive: true });
  const binary = testBinaryScript(version);

  for (const asset of RELEASE_ASSETS) writeFileSync(join(releaseDir, asset), binary);
  writeFileSync(join(releaseDir, "checksums.txt"), checksumsText(binary, corruptChecksums));
}

describe("install matrix host", () => {
  let assetsDir = "";

  beforeEach(() => {
    assetsDir = mkdtempSync(join(tmpdir(), "install-matrix-assets-"));
  });

  afterEach(() => {
    rmSync(assetsDir, { recursive: true, force: true });
  });

  test("passes every scenario against a clean release", async () => {
    writeRelease(assetsDir, "900.0.0", false);
    writeRelease(assetsDir, "900.0.1", false);
    const result = await runMatrix({
      scenarioNames: ["curl-clean", "curl-rerun", "curl-upgrade", "plugin"],
      installerPath: INSTALLER,
      repoRoot: REPO_ROOT,
      platform: "test",
      assetsDir,
      version: "900.0.1",
      previousVersion: "900.0.0",
    });

    for (const scenario of result.scenarios) {
      const failures = scenario.assertions.filter((assertion) => !assertion.passed);

      expect({ name: scenario.name, failures }).toEqual({ name: scenario.name, failures: [] });
    }

    expect(result.passed).toBe(true);
  });

  test("fails the clean scenario when the checksum is wrong", async () => {
    writeRelease(assetsDir, "900.0.1", true);
    const result = await runMatrix({
      scenarioNames: ["curl-clean"],
      installerPath: INSTALLER,
      repoRoot: REPO_ROOT,
      platform: "test",
      assetsDir,
      version: "900.0.1",
      previousVersion: "",
    });

    const clean = result.scenarios[0];

    expect(clean?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
});
