import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { focusHerdrPane, returnPaneFor } from "./herdr";

let dir: string;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cueloop-herdr-"));
  for (const k of ["HERDR_ENV", "HERDR_PANE_ID", "HERDR_BIN_PATH", "CUELOOP_RETURN_PANE"]) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("returnPaneFor", () => {
  test("outside herdr there is never a return target", () => {
    expect(returnPaneFor("w1:p1")).toBeUndefined();
  });

  test("env override wins, session meta is the fallback", () => {
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "w1:p9";
    expect(returnPaneFor("w1:p1")).toBe("w1:p1");
    process.env.CUELOOP_RETURN_PANE = "w1:p2";
    expect(returnPaneFor("w1:p1")).toBe("w1:p2");
  });

  test("returning to our own pane is a no-op", () => {
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "w1:p1";
    expect(returnPaneFor("w1:p1")).toBeUndefined();
  });
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
    process.env.HERDR_BIN_PATH = stub;
    expect(focusHerdrPane("w1:p1")).toBe(true);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls[0]).toBe("pane get w1:p1");
    expect(calls[1]).toBe("tab focus w1:t3");
  });

  test("a missing binary never throws", () => {
    process.env.HERDR_BIN_PATH = join(dir, "nope");
    expect(focusHerdrPane("w1:p1")).toBe(false);
  });
});
