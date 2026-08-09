import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { focusHerdrPane } from "./herdr";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("focusHerdrPane", () => {
  test("resolves the pane's tab and focuses it", () => {
    const log = join(dir, "calls.log");
    const stub = join(dir, "herdr");
    writeFileSync(
      stub,
      `#!/bin/sh
echo "$@" >> "${log}"
if [ "$1" = "pane" ]; then echo '{"result":{"pane":{"tab_id":"w1:t3"}}}'; fi
`,
    );
    Bun.spawnSync(["chmod", "+x", stub]);
    expect(focusHerdrPane(stub, "w1:p1")).toBe(true);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls[0]).toBe("pane get w1:p1");
    expect(calls[1]).toBe("tab focus w1:t3");
  });

  test("a missing binary never throws", () => {
    expect(focusHerdrPane(join(dir, "nope"), "w1:p1")).toBe(false);
  });
});
