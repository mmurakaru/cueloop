/**
 * Black-box help catalogue (tier 3): `cueloop --help` and `cueloop help` print
 * the grouped command catalogue and exit 0; an unknown command prints the same
 * catalogue but exits nonzero so scripts can tell the two apart.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../helpers/cli";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-help-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

for (const argument of ["--help", "help"] as const) {
  test(`\`cueloop ${argument}\` prints the catalogue and exits 0`, async () => {
    const result = await runCli(home, [argument]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("common commands:");
    expect(result.stdout).toContain("share:");
    expect(result.stdout).toContain("scripting:");
    for (const primitive of [
      "cueloop plan",
      "cueloop diff",
      "cueloop review",
      "cueloop serve",
      "cueloop share",
      "cueloop session",
    ]) {
      expect(result.stdout).toContain(primitive);
    }
  });
}

test("an unknown command prints the catalogue and exits nonzero", async () => {
  const result = await runCli(home, ["frobnicate"]);

  expect(result.code).toBe(2);
  expect(result.stdout).toContain("common commands:");
});
