import { describe, expect, test } from "bun:test";
import {
  blockRuns,
  buildDisplay,
  cutBlock,
  displayText,
  marksByDisplay,
  overlayMarks,
  restoreBlock,
  restoreLine,
  spanKey,
  startSpan,
  wrapRuns,
} from "./view";
import { parseBlocks, type Annotation } from "@cueloop/schema";

const BASE = `# Plan

## Context

The daemon persists sessions to disk atomically.

- first item
- second item
`;

describe("buildDisplay reconciliation", () => {
  test("no working copy: everything is same", () => {
    const d = buildDisplay(BASE);
    expect(d.every((x) => x.type === "same")).toBe(true);
  });

  test("reworded block pairs as mod (similar)", () => {
    const working = BASE.replace("persists sessions to disk", "writes sessions to disk");
    const d = buildDisplay(BASE, working);
    const mod = d.find((x) => x.type === "mod")!;
    expect(mod.base!.text).toContain("persists");
    expect(mod.work!.text).toContain("writes");
  });

  test("unrelated cut + insert do NOT merge into a mod", () => {
    const working = BASE.replace("- second item\n", "") + "\nA totally new closing note.\n";
    const d = buildDisplay(BASE, working);
    expect(d.some((x) => x.type === "del" && x.base!.text === "second item")).toBe(true);
    expect(d.some((x) => x.type === "add" && x.work!.text.includes("closing note"))).toBe(true);
    expect(d.some((x) => x.type === "mod")).toBe(false);
  });

  test("ordered list items get running numbers", () => {
    const d = buildDisplay("1. one\n2. two\n3. three\n");
    expect(d.map((x) => x.oliNum)).toEqual([1, 2, 3]);
  });
});

describe("blockRuns + overlayMarks", () => {
  test("mod blocks emit word-diff runs that reconstruct both sides", () => {
    const d = buildDisplay("plain old text here\n", "plain new text here\n")[0]!;
    const runs = blockRuns(d, true);
    const oldSide = runs.filter((r) => r.role !== "ins").map((r) => r.text).join("");
    const newSide = runs.filter((r) => r.role !== "del").map((r) => r.text).join("");
    expect(oldSide).toBe("plain old text here");
    expect(newSide).toBe("plain new text here");
  });

  test("marks bind to working-text offsets and skip del runs", () => {
    const d = buildDisplay("old words linger\n", "new words linger\n")[0]!;
    const runs = blockRuns(d, true);
    const marked = overlayMarks(runs, [{ start: 4, end: 9, role: "mark-comment" }]); // "words"
    const markedText = marked.filter((r) => r.role === "mark-comment").map((r) => r.text).join("");
    expect(markedText).toBe("words");
    // del run text untouched
    expect(marked.some((r) => r.role === "del" && r.text === "old")).toBe(true);
  });

  test("marks never override ins emphasis", () => {
    const d = buildDisplay("keep\n", "keep added\n")[0]!;
    const runs = overlayMarks(blockRuns(d, true), [{ start: 0, end: 10, role: "mark-comment" }]);
    expect(runs.some((r) => r.role === "ins")).toBe(true);
  });
});

describe("marksByDisplay", () => {
  test("annotations resolve into display coordinates", () => {
    const working = BASE.replace("first item", "first item edited beyond recognition of it");
    const display = buildDisplay(BASE, working);
    const ann: Annotation = {
      id: "a1",
      kind: "comment",
      anchor: { quote: "atomically", prefix: "to disk ", suffix: "." },
      body: "define atomically",
      createdAt: "",
    };
    const map = marksByDisplay([ann], display);
    const [dispIdx, marks] = [...map.entries()][0]!;
    expect(displayText(display[dispIdx]!)).toContain("atomically");
    expect(marks[0]!.annotationId).toBe("a1");
  });

  test("orphaned annotations produce no marks", () => {
    const display = buildDisplay(BASE);
    const ann: Annotation = {
      id: "a1",
      kind: "comment",
      anchor: { quote: "text that is gone", prefix: "", suffix: "" },
      body: "",
      createdAt: "",
    };
    expect(marksByDisplay([ann], display).size).toBe(0);
  });
});

describe("wrapRuns", () => {
  test("wraps at word boundaries within width", () => {
    const lines = wrapRuns([{ text: "alpha beta gamma delta", role: "plain", start: 0 }], 11);
    const rendered = lines.map((l) => l.map((r) => r.text).join(""));
    expect(rendered.every((l) => l.length <= 11)).toBe(true);
    expect(rendered.join(" ").replace(/\s+/g, " ").trim()).toBe("alpha beta gamma delta");
  });

  test("hard-splits words longer than the width", () => {
    const lines = wrapRuns([{ text: "abcdefghij", role: "plain", start: 0 }], 4);
    expect(lines.length).toBeGreaterThan(1);
  });

  test("newlines force line breaks (code blocks)", () => {
    const lines = wrapRuns([{ text: "line1\nline2", role: "plain", start: 0 }], 80);
    expect(lines.length).toBe(2);
  });
});

describe("span mode", () => {
  const text = "one two three four";
  test("v selects the first word; l grows; w slides; $ to end", () => {
    let s = startSpan(0, text)!;
    expect(text.slice(s.start, s.end)).toBe("one");
    s = spanKey(s, "l", text);
    expect(text.slice(s.start, s.end)).toBe("one two");
    s = spanKey(s, "w", text);
    expect(text.slice(s.start, s.end)).toBe("two three");
    s = spanKey(s, "$", text);
    expect(text.slice(s.start, s.end)).toBe("two three four");
  });
});

describe("cut / restore round-trip", () => {
  test("cut removes the block lines; restore puts them back", () => {
    const blocks = parseBlocks(BASE);
    const li = blocks.find((b) => b.text === "second item")!;
    const cut = cutBlock(BASE, li);
    expect(cut).not.toContain("second item");
    const display = buildDisplay(BASE, cut);
    const delIdx = display.findIndex((d) => d.type === "del");
    const line = restoreLine(display, delIdx, cut.split("\n").length);
    const restored = restoreBlock(cut, "- second item", line);
    expect(buildDisplay(BASE, restored).every((d) => d.type === "same")).toBe(true);
  });
});
