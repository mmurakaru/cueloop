import { describe, expect, test } from "bun:test";
import { lcsDiff, unifiedDiff, unifiedDiffText, editStats, wordDiff } from "./diff";

describe("unifiedDiff", () => {
  test("equal inputs return null, not an empty diff", () => {
    expect(unifiedDiff("a\nb", "a\nb")).toBeNull();
  });

  test("produces hunk headers with correct line numbers", () => {
    const oldText = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"].join("\n");
    const newText = ["l1", "l2", "l3", "CHANGED", "l5", "l6", "l7", "l8"].join("\n");
    const d = unifiedDiff(oldText, newText, 1)!;
    expect(d[0]!.t).toBe("hunk");
    expect(d[0]!.text).toBe("@@ -3,3 +3,3 @@");
    expect(d.map((l) => l.text)).toEqual([
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
    const d = unifiedDiff(oldLines.join("\n"), newLines.join("\n"), 2)!;
    expect(d.filter((l) => l.t === "hunk").length).toBe(2);
  });

  test("applies cleanly: reconstructing new text from old + diff", () => {
    const oldText = "keep\ndrop\nkeep2\nkeep3";
    const newText = "keep\nadded\nkeep2\nkeep3\ntail";
    const d = unifiedDiff(oldText, newText, 50)!;
    const rebuilt: string[] = [];
    for (const l of d) {
      if (l.t === "hunk") continue;
      if (l.t === "ctx" || l.t === "add") rebuilt.push(l.text.slice(1));
    }
    expect(rebuilt.join("\n")).toBe(newText);
  });

  test("unifiedDiffText carries file headers and path", () => {
    const t = unifiedDiffText("a", "b", "docs/plan.md")!;
    expect(t.startsWith("--- a/docs/plan.md\n+++ b/docs/plan.md\n@@")).toBe(true);
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
    const oldSide = ops.filter((o) => o.t !== "add").map((o) => o.a).join("");
    const newSide = ops.filter((o) => o.t !== "del").map((o) => o.b).join("");
    expect(oldSide).toBe("the quick brown fox");
    expect(newSide).toBe("the slow brown foxes");
  });
});

describe("lcsDiff", () => {
  test("custom equality", () => {
    const ops = lcsDiff([{ v: 1 }, { v: 2 }], [{ v: 2 }, { v: 3 }], (x, y) => x.v === y.v);
    expect(ops.map((o) => o.t)).toEqual(["del", "ctx", "add"]);
  });
});
