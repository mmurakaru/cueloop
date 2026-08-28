import { describe, expect, test } from "bun:test";
import { diffRowAnchor, diffRows } from "./view-diff";

const PATCH = `diff --git a/src/store.ts b/src/store.ts
index 111..222 100644
--- a/src/store.ts
+++ b/src/store.ts
@@ -1,5 +1,6 @@
 import { join } from "node:path";
 export class Store {
-  private items = [];
+  private items = new Map();
+  private ready = false;
   constructor() {}
@@ -20,3 +21,3 @@
 export function helper() {
-  return 1;
+  return 2;
 }
`;

describe("diffRows", () => {
  test("flattens files, hunks, and signed lines with line numbers", () => {
    // Act
    const rows = diffRows(PATCH);

    // Assert
    expect(rows[0]).toMatchObject({ kind: "file", file: "src/store.ts" });
    expect(rows[1]!.kind).toBe("hunk");
    const del = rows.find((row) => row.kind === "del")!;

    expect(del.text).toContain("private items = [];");
    expect(del.oldLine).toBe(3);
    const adds = rows.filter((row) => row.kind === "add");

    expect(adds[0]!.text).toContain("new Map()");
    expect(adds[0]!.newLine).toBe(3);
    expect(adds[1]!.newLine).toBe(4);
    // two hunks
    expect(rows.filter((row) => row.kind === "hunk").length).toBe(2);
  });

  test("context lines carry both line numbers", () => {
    // Act
    const rows = diffRows(PATCH);

    // Assert
    const ctx = rows.find((row) => row.kind === "ctx")!;

    expect(ctx.oldLine).toBe(1);
    expect(ctx.newLine).toBe(1);
  });
});

describe("diffRowAnchor", () => {
  test("quote is the line, neighbors are the context selectors", () => {
    // Arrange
    const rows = diffRows(PATCH);
    const rowIndex = rows.findIndex((row) => row.text.includes("new Map()"));

    // Act
    const anchor = diffRowAnchor(rows, rowIndex);

    // Assert
    expect(anchor.quote).toContain("new Map()");
    expect(anchor.prefix.length).toBeGreaterThan(0);
    expect(anchor.suffix.length).toBeGreaterThan(0);
  });
});
