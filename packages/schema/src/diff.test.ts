import { describe, expect, test } from "bun:test";
import { lcsDiff, unifiedDiff, unifiedDiffText, editStats, wordDiff } from "./diff";

describe("unifiedDiff", () => {
  test("equal inputs return null, not an empty diff", () => {
    expect(unifiedDiff("a\nb", "a\nb")).toBeNull();
  });

  test("produces hunk headers with correct line numbers", () => {
    const oldText = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"].join("\n");
    const newText = ["l1", "l2", "l3", "CHANGED", "l5", "l6", "l7", "l8"].join("\n");
    const diffLines = unifiedDiff(oldText, newText, 1)!;
    expect(diffLines[0]!.kind).toBe("hunk");
    expect(diffLines[0]!.text).toBe("@@ -3,3 +3,3 @@");
    expect(diffLines.map((line) => line.text)).toEqual([
      "@@ -3,3 +3,3 @@",
      " l3",
      "-l4",
      "+CHANGED",
      " l5",
    ]);
  });

  test("distant changes split into separate hunks", () => {
    const oldLines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const newLines = [...oldLines];
    newLines[1] = "first change";
    newLines[27] = "second change";
    const diffLines = unifiedDiff(oldLines.join("\n"), newLines.join("\n"), 2)!;
    expect(diffLines.filter((line) => line.kind === "hunk").length).toBe(2);
  });

  test("applies cleanly: reconstructing new text from old + diff", () => {
    const oldText = "keep\ndrop\nkeep2\nkeep3";
    const newText = "keep\nadded\nkeep2\nkeep3\ntail";
    const diffLines = unifiedDiff(oldText, newText, 50)!;
    const rebuilt: string[] = [];
    for (const line of diffLines) {
      if (line.kind === "hunk") continue;
      if (line.kind === "ctx" || line.kind === "add") rebuilt.push(line.text.slice(1));
    }
    expect(rebuilt.join("\n")).toBe(newText);
  });

  test("unifiedDiffText carries file headers and path", () => {
    const diffText = unifiedDiffText("a", "b", "docs/plan.md")!;
    expect(diffText.startsWith("--- a/docs/plan.md\n+++ b/docs/plan.md\n@@")).toBe(true);
  });
});

describe("editStats", () => {
  test("counts added and removed lines", () => {
    expect(editStats("a\nb\nc", "a\nx\nc\nd")).toEqual({ added: 2, removed: 1 });
  });
});

describe("wordDiff", () => {
  test("preserves whitespace tokens and reconstructs both sides", () => {
    const ops = wordDiff("the quick brown fox", "the slow brown foxes");
    const oldSide = ops.filter((op) => op.kind !== "add").map((op) => op.oldValue).join("");
    const newSide = ops.filter((op) => op.kind !== "del").map((op) => op.newValue).join("");
    expect(oldSide).toBe("the quick brown fox");
    expect(newSide).toBe("the slow brown foxes");
  });
});

describe("lcsDiff", () => {
  test("custom equality", () => {
    const ops = lcsDiff([{ v: 1 }, { v: 2 }], [{ v: 2 }, { v: 3 }], (oldItem, newItem) => oldItem.v === newItem.v);
    expect(ops.map((op) => op.kind)).toEqual(["del", "ctx", "add"]);
  });
});
