/** Herdr Thread-surface handles survive reload and reject corrupt records. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrThreadSurfaceStore } from "./herdr-thread-surface-store";
import { herdrThreadSurfacesPath } from "./paths";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-herdr-store-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("HerdrThreadSurfaceStore", () => {
  test("set then get returns the handle; get for an unknown session is null", () => {
    const store = new HerdrThreadSurfaceStore(home);

    store.set("ses_1", { tabId: "w1:t2", paneId: "w1:p2" });

    expect(store.get("ses_1")).toEqual({ tabId: "w1:t2", paneId: "w1:p2" });
    expect(store.get("ses_missing")).toBeNull();
  });

  test("handles survive a reload from disk", () => {
    new HerdrThreadSurfaceStore(home).set("ses_1", { tabId: "w1:t2", paneId: "w1:p2" });

    const reloaded = new HerdrThreadSurfaceStore(home);

    expect(reloaded.get("ses_1")).toEqual({ tabId: "w1:t2", paneId: "w1:p2" });
  });

  test("delete removes the handle", () => {
    const store = new HerdrThreadSurfaceStore(home);

    store.set("ses_1", { tabId: "w1:t2", paneId: "w1:p2" });

    store.delete("ses_1");

    expect(store.get("ses_1")).toBeNull();
  });

  test("a corrupt file starts empty instead of throwing", () => {
    writeFileSync(herdrThreadSurfacesPath(home), "not json");

    const store = new HerdrThreadSurfaceStore(home);

    expect(store.get("ses_1")).toBeNull();
  });

  test("malformed entries are dropped, well-formed ones survive", () => {
    writeFileSync(
      herdrThreadSurfacesPath(home),
      JSON.stringify({
        ses_ok: { tabId: "w1:t2", paneId: "w1:p2" },
        ses_partial: { tabId: "w1:t2" },
        ses_typed: { tabId: 1, paneId: 2 },
        ses_pane_missing_source: { tabId: "w1:t2", paneId: "w1:p3", mode: "pane" },
        ses_null: null,
      }),
    );

    const store = new HerdrThreadSurfaceStore(home);

    expect(store.get("ses_ok")).toEqual({ tabId: "w1:t2", paneId: "w1:p2" });
    expect(store.get("ses_partial")).toBeNull();
    expect(store.get("ses_typed")).toBeNull();
    expect(store.get("ses_pane_missing_source")).toBeNull();
    expect(store.get("ses_null")).toBeNull();
  });

  test("a non-object top level starts empty", () => {
    writeFileSync(herdrThreadSurfacesPath(home), JSON.stringify(["not", "a", "map"]));

    expect(new HerdrThreadSurfaceStore(home).get("ses_1")).toBeNull();
  });
});
