/** Pure walk projections: file steps, resume index, viewed counts, notes. */

import { describe, expect, test } from "bun:test";
import type { Annotation } from "@cueloop/schema";
import { diffRows } from "./view-diff";
import { firstUnviewedIndex, noteForFile, viewedCount, walkFiles, WALK_PREVIEW_ROWS } from "./walk";

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 export const a = 1;
-export const b = 2;
+export const b = 3;
+export const c = 4;
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
 // header
-old line
+new line
diff --git a/src/c.ts b/src/c.ts
index 555..666 100644
--- a/src/c.ts
+++ b/src/c.ts
@@ -1,1 +1,8 @@
-gone
+one
+two
+three
+four
+five
+six
+seven
`;

const rows = diffRows(PATCH);
const files = walkFiles(rows);

describe("walkFiles", () => {
  test("one step per changed file, in patch order, with counted stats", () => {
    expect(files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(files[0]).toMatchObject({ added: 2, removed: 1 });
    expect(files[1]).toMatchObject({ added: 1, removed: 1 });
    expect(files[2]).toMatchObject({ added: 7, removed: 1 });
  });

  test("previews carry signed changed lines and cap at the preview budget", () => {
    expect(files[0]!.preview).toEqual([
      { sign: "-", text: "export const b = 2;" },
      { sign: "+", text: "export const b = 3;" },
      { sign: "+", text: "export const c = 4;" },
    ]);
    expect(files[2]!.preview.length).toBe(WALK_PREVIEW_ROWS);
    expect(files[2]!.preview[0]).toEqual({ sign: "-", text: "gone" });
  });
});

describe("firstUnviewedIndex", () => {
  test("starts at the first file when nothing is viewed", () => {
    expect(firstUnviewedIndex(files, new Set())).toBe(0);
  });

  test("skips viewed files - a resumed review lands on its first gap", () => {
    expect(firstUnviewedIndex(files, new Set(["src/a.ts"]))).toBe(1);
    expect(firstUnviewedIndex(files, new Set(["src/a.ts", "src/b.ts"]))).toBe(2);
    // a viewed file later in the list does not block the earlier gap
    expect(firstUnviewedIndex(files, new Set(["src/c.ts"]))).toBe(0);
  });

  test("all viewed resumes on the end card, not the first file", () => {
    expect(firstUnviewedIndex(files, new Set(["src/a.ts", "src/b.ts", "src/c.ts"]))).toBe(
      files.length,
    );
  });
});

describe("viewedCount", () => {
  test("counts only paths present in the current file set", () => {
    expect(viewedCount(files, new Set(["src/a.ts", "src/gone-in-rev-2.ts"]))).toBe(1);
  });
});

describe("noteForFile", () => {
  const note = (path: string, body: string): Annotation => ({
    id: `a_${path}`,
    kind: "note",
    anchor: { quote: path, prefix: "", suffix: "" },
    body,
    createdAt: "now",
  });

  test("finds the note anchored at the file path", () => {
    // Arrange
    const annotations = [
      note("src/a.ts", "Renames b and adds c."),
      note("src/b.ts", "Swaps the line."),
    ];

    // Assert
    expect(noteForFile(annotations, "src/b.ts")).toBe("Swaps the line.");
    expect(noteForFile(annotations, "src/c.ts")).toBeUndefined();
  });

  test("ignores non-note annotations that happen to quote the path", () => {
    // Arrange
    const comment: Annotation = {
      id: "a_1",
      kind: "comment",
      anchor: { quote: "src/a.ts", prefix: "", suffix: "" },
      body: "not a note",
      createdAt: "now",
    };

    // Assert
    expect(noteForFile([comment], "src/a.ts")).toBeUndefined();
  });
});
