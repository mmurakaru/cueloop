/**
 * Black-box version routing: the real entrypoint spawned as a subprocess must
 * print the manifest version for `-v`/`--version`/`version` and exit 0, rather
 * than falling through to the help dump.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../helpers/cli";

const manifest = await Bun.file(
  join(import.meta.dir, "..", "..", "packages", "cli", "package.json"),
).json();

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-version-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("cueloop version (black box)", () => {
  for (const flag of ["-v", "--version", "version"]) {
    test(`${flag} prints the version and exits 0`, async () => {
      // Act
      const runResult = await runCli(home, [flag]);

      // Assert
      expect(runResult.code).toBe(0);
      expect(runResult.stdout.trim()).toBe(manifest.version);
    });
  }
});
