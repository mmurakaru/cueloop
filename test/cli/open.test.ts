/**
 * Black-box verb-first open routing (tier 3): the real entrypoint spawned as a
 * subprocess against a fresh daemon home. Covers the miss branches that never
 * launch the TUI - a fresh home has nothing pending, so every opener falls
 * through to its plain "nothing to open" line and a nonzero exit.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { runCli } from "../helpers/cli";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-open-"));
});
afterEach(async () => {
  try {
    const client = await DaemonClient.connect({ home });
    await client.shutdown();
    client.close();
  } catch {
    // daemon already gone
  }
  rmSync(home, { recursive: true, force: true });
});

describe("cueloop plan (black box)", () => {
  test("no pending plan reports nothing to open and exits 1", async () => {
    const runResult = await runCli(home, ["plan"]);
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain("no pending plan review - nothing to open");
  });

  test("an unknown selector reports no match and exits 1", async () => {
    const runResult = await runCli(home, ["plan", "does-not-exist"]);
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain('no plan review matches "does-not-exist" - nothing to open');
  });

  test("--latest with nothing pending reports nothing to open", async () => {
    const runResult = await runCli(home, ["plan", "--latest"]);
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain("no pending plan review - nothing to open");
  });
});

describe("cueloop review (black box, open path)", () => {
  test("--latest with no pending PR review reports nothing to open", async () => {
    const runResult = await runCli(home, ["review", "--latest"]);
    expect(runResult.code).toBe(1);
    expect(runResult.stderr).toContain("no pending PR review - nothing to open");
  });
});
