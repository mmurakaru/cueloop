/** herdr tab side-store: set/get/delete round-trips, survives a reload from disk, and ignores a corrupt file. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrTabStore } from "./herdr-tab-store";
import { herdrTabsPath } from "./paths";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-herdr-store-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("HerdrTabStore", () => {
  test("set then get returns the handle; get for an unknown session is null", () => {
    // Arrange
    const store = new HerdrTabStore(home);

    // Act
    store.set("ses_1", { tabId: "w1:t2", paneId: "w1:p2" });

    // Assert
    expect(store.get("ses_1")).toEqual({ tabId: "w1:t2", paneId: "w1:p2" });
    expect(store.get("ses_missing")).toBeNull();
  });

  test("handles survive a reload from disk", () => {
    // Arrange
    new HerdrTabStore(home).set("ses_1", { tabId: "w1:t2", paneId: "w1:p2" });

    // Act - a fresh store over the same home loads the persisted file
    const reloaded = new HerdrTabStore(home);

    // Assert
    expect(reloaded.get("ses_1")).toEqual({ tabId: "w1:t2", paneId: "w1:p2" });
  });

  test("delete removes the handle", () => {
    // Arrange
    const store = new HerdrTabStore(home);
    store.set("ses_1", { tabId: "w1:t2", paneId: "w1:p2" });

    // Act
    store.delete("ses_1");

    // Assert
    expect(store.get("ses_1")).toBeNull();
  });

  test("a corrupt file starts empty instead of throwing", () => {
    // Arrange
    writeFileSync(herdrTabsPath(home), "not json");

    // Act
    const store = new HerdrTabStore(home);

    // Assert
    expect(store.get("ses_1")).toBeNull();
  });
});
