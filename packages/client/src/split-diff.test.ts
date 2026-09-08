import { describe, expect, test } from "bun:test";
import { diffRows } from "./view-diff";
import { splitDiffRows, splitRowOffsets, type SplitRow } from "./split-diff";

const PATCH = `diff --git a/greet.ts b/greet.ts
--- a/greet.ts
+++ b/greet.ts
@@ -1,4 +1,4 @@
 const name = "world";
-console.log("hi " + name);
-console.log("done");
+console.log("hello " + name);
+console.log("finished");
 export {};
`;

function pairs(rows: SplitRow[]): SplitRow[] {
  return rows.filter((row) => row.kind === "pair");
}

describe("splitDiffRows", () => {
  test("carries the file and hunk headers through unchanged", () => {
    // Act
    const split = splitDiffRows(diffRows(PATCH));

    // Assert
    expect(split[0]).toMatchObject({ kind: "file", file: "greet.ts", text: "greet.ts" });
    expect(split[1]?.kind).toBe("hunk");
  });

  test("a context line sits on both sides with its own line numbers", () => {
    // Act
    const first = pairs(splitDiffRows(diffRows(PATCH)))[0]!;

    // Assert
    expect(first.left).toMatchObject({ kind: "ctx", lineNumber: 1 });
    expect(first.right).toMatchObject({ kind: "ctx", lineNumber: 1 });
    expect(first.left?.text).toBe(first.right?.text);
  });

  test("a balanced change block pairs each deletion against an addition", () => {
    // Act - the two deletions zip against the two additions, one per row
    const changed = pairs(splitDiffRows(diffRows(PATCH))).filter(
      (row) => row.left?.kind === "del" || row.right?.kind === "add",
    );

    // Assert
    expect(changed).toHaveLength(2);
    expect(changed[0]).toMatchObject({
      left: { kind: "del", lineNumber: 2 },
      right: { kind: "add", lineNumber: 2 },
    });
    expect(changed[1]).toMatchObject({
      left: { kind: "del", lineNumber: 3 },
      right: { kind: "add", lineNumber: 3 },
    });
  });

  test("an unbalanced block blank-fills the shorter side", () => {
    // Arrange - one deletion, three additions
    const patch = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,2 +1,4 @@
 keep;
-old;
+new1;
+new2;
+new3;
`;

    // Act
    const changed = pairs(splitDiffRows(diffRows(patch))).filter(
      (row) => row.left?.kind === "del" || row.right?.kind === "add",
    );

    // Assert - three rows tall, only the first has a left deletion
    expect(changed).toHaveLength(3);
    expect(changed[0]?.left?.kind).toBe("del");
    expect(changed[1]?.left).toBeUndefined();
    expect(changed[2]?.left).toBeUndefined();
    expect(changed.map((row) => row.right?.text.trim())).toEqual(["new1;", "new2;", "new3;"]);
  });

  test("each side keeps its originating unified row for anchoring", () => {
    // Act
    const base = diffRows(PATCH);
    const changed = pairs(splitDiffRows(base)).find((row) => row.right?.kind === "add")!;

    // Assert - the split line points back at a row from the base list
    expect(base[changed.right!.rowIndex]).toBe(changed.right!.row);
  });
});

describe("splitRowOffsets", () => {
  test("maps both sides of a pair to the same y and steps a file band by three", () => {
    // Arrange
    const base = diffRows(PATCH);
    const split = splitDiffRows(base);

    // Act
    const offsets = splitRowOffsets(split);

    // Assert - the file band is three rows and the hunk one, so the first context pair sits at y 4
    const firstContext = split.find((row) => row.kind === "pair" && row.left?.kind === "ctx")!;

    expect(offsets.get(firstContext.left!.rowIndex)).toBe(4);
    expect(offsets.get(firstContext.right!.rowIndex)).toBe(4);
  });
});
