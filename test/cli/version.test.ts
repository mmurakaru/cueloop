/**
 * Black-box version routing: the real entrypoint spawned as a subprocess must
 * print the manifest version for `-v`/`--version`/`version` and exit 0, rather
 * than falling through to the help dump.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { runCli } from "../helpers/cli";

const manifest = await Bun.file(
  join(import.meta.dir, "..", "..", "packages", "cli", "package.json"),
).json();

describe("cueloop version (black box)", () => {
  for (const flag of ["-v", "--version", "version"]) {
    test(`${flag} prints the version and exits 0`, async () => {
      // Arrange
      const home = mkdtempSync(join(tmpdir(), "cueloop-version-"));

      // Act
      const runResult = await runCli(home, [flag]);

      // Assert
      expect(runResult.code).toBe(0);
      expect(runResult.stdout.trim()).toBe(manifest.version);
    });
  }
});
