import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhosttyThreadSurfaceStore } from "./ghostty-thread-surface-store";
import { ghosttyThreadSurfacesPath } from "./paths";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-ghostty-store-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("GhosttyThreadSurfaceStore", () => {
  test("persists terminal IDs outside Thread records and reloads them", () => {
    const store = new GhosttyThreadSurfaceStore(home);

    store.set("ses_one", { terminalId: "term-1" });
    expect(new GhosttyThreadSurfaceStore(home).get("ses_one")).toEqual({ terminalId: "term-1" });
    expect(JSON.parse(readFileSync(ghosttyThreadSurfacesPath(home), "utf8"))).toEqual({
      ses_one: { terminalId: "term-1" },
    });
    store.delete("ses_one");
    expect(new GhosttyThreadSurfaceStore(home).get("ses_one")).toBeNull();
  });

  test("ignores malformed scratch state", () => {
    writeFileSync(ghosttyThreadSurfacesPath(home), '{"ses_one":{"terminalId":3}}');

    expect(new GhosttyThreadSurfaceStore(home).get("ses_one")).toBeNull();
  });

  test("reserves a Thread before launch and fails closed across daemon restart", () => {
    const store = new GhosttyThreadSurfaceStore(home);

    expect(store.claim("ses_one")).toBe(true);
    expect(store.claim("ses_one")).toBe(false);
    expect(new GhosttyThreadSurfaceStore(home).claim("ses_one")).toBe(false);
    store.set("ses_one", { terminalId: "term-1" });
    expect(new GhosttyThreadSurfaceStore(home).claim("ses_one")).toBe(true);
    store.release("ses_one");
    expect(new GhosttyThreadSurfaceStore(home).get("ses_one")).toEqual({ terminalId: "term-1" });
    expect(new GhosttyThreadSurfaceStore(home).claim("ses_one")).toBe(true);
  });
});
