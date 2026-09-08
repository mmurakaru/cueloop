/** Per-file collapse and full-file weave over the flat diff rows. */

import { describe, expect, test } from "bun:test";
import type { DiffRow } from "./view-diff";
import { applyFold, weaveFullFileRows } from "./diff-fold";

function row(kind: DiffRow["kind"], text: string, extra: Partial<DiffRow> = {}): DiffRow {
  return { kind, text, file: "a.ts", ...extra };
}

// a two-line change in a four-line file: line 2 swapped, lines 1/3/4 unchanged
const base: DiffRow[] = [
  row("file", "a.ts"),
  row("hunk", "@@ -1,3 +1,3 @@"),
  row("ctx", "line one", { oldLine: 1, newLine: 1 }),
  row("del", "old two", { oldLine: 2 }),
  row("add", "new two", { newLine: 2 }),
  row("ctx", "line three", { oldLine: 3, newLine: 3 }),
];

const contents = {
  path: "a.ts",
  oldContents: "line one\nold two\nline three\nline four\n",
  newContents: "line one\nnew two\nline three\nline four\n",
};

describe("applyFold", () => {
  test("with no fold state it returns the base rows unchanged", () => {
    expect(applyFold(base, new Set(), new Set(), [contents])).toBe(base);
  });

  test("a collapsed file keeps only its file band", () => {
    // Act
    const folded = applyFold(base, new Set(["a.ts"]), new Set(), [contents]);

    // Assert
    expect(folded).toHaveLength(1);
    expect(folded[0]).toEqual(row("file", "a.ts"));
  });

  test("an expanded file weaves the unchanged tail line the hunk never showed", () => {
    // Act
    const folded = applyFold(base, new Set(), new Set(["a.ts"]), [contents]);

    // Assert - the hunk header is gone and "line four" (outside the hunk) now shows
    expect(folded.some((r) => r.kind === "hunk")).toBe(false);
    const four = folded.find((r) => r.text === "line four");

    expect(four).toEqual(row("ctx", "line four", { oldLine: 4, newLine: 4 }));
  });

  test("expand is a no-op without the file's full contents", () => {
    // Act - no contents entry, so the file keeps its hunks
    const folded = applyFold(base, new Set(), new Set(["a.ts"]), undefined);

    // Assert
    expect(folded).toEqual(base);
  });
});

describe("weaveFullFileRows", () => {
  test("keeps the change rows and fills every unchanged line as context in order", () => {
    // Arrange - the file's code rows (no headers)
    const codeRows = base.slice(2);

    // Act
    const woven = weaveFullFileRows("a.ts", codeRows, contents.newContents);

    // Assert - full file: ctx1, del, add, ctx3, ctx4
    expect(woven.map((r) => `${r.kind}:${r.text}`)).toEqual([
      "ctx:line one",
      "del:old two",
      "add:new two",
      "ctx:line three",
      "ctx:line four",
    ]);
  });
});
