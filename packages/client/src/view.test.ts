import { describe, expect, test } from "bun:test";
import {
  blockRuns,
  buildDisplay,
  displayText,
  marksByDisplay,
  nextWorkBlock,
  overlayMarks,
  renderedOffsetFor,
  spanKey,
  startSpan,
  workRangeForRendered,
} from "./view";
import { cutBlock, parseBlocks, restoreBlock, restoreLine, type Annotation } from "@cueloop/schema";

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

describe("rendered/work offset mapping", () => {
  test("plain blocks map 1:1 in both directions", () => {
    const d = buildDisplay("alpha beta gamma\n")[0]!;
    const runs = blockRuns(d, true);
    expect(renderedOffsetFor(runs, 6)).toBe(6);
    expect(workRangeForRendered(runs, 6, 10)).toEqual({ start: 6, end: 10 });
  });

  test("inline del runs shift rendered offsets in word-diffed blocks", () => {
    // rendered: "old new words linger" - "old " is a del run without offsets
    const d = buildDisplay("old words linger\n", "new words linger\n")[0]!;
    const runs = blockRuns(d, true);
    const workText = displayText(d);
    const wordsAt = workText.indexOf("words");
    const rendered = renderedOffsetFor(runs, wordsAt)!;
    const renderedText = runs.map((r) => r.text).join("");
    expect(renderedText.slice(rendered, rendered + "words".length)).toBe("words");
    // reading a rendered selection over "words" recovers the work range
    expect(workRangeForRendered(runs, rendered, rendered + "words".length)).toEqual({
      start: wordsAt,
      end: wordsAt + "words".length,
    });
  });

  test("a rendered selection spanning a del run keeps only positioned text", () => {
    const d = buildDisplay("old words\n", "new words\n")[0]!;
    const runs = blockRuns(d, true);
    const renderedText = runs.map((r) => r.text).join("");
    // select everything rendered: the work range is the whole work text
    const range = workRangeForRendered(runs, 0, renderedText.length)!;
    expect(displayText(d).slice(range.start, range.end)).toBe(displayText(d));
  });

  test("offsets outside any positioned run map to null", () => {
    const runs = blockRuns(buildDisplay("short\n")[0]!, true);
    expect(renderedOffsetFor(runs, 99)).toBeNull();
    expect(workRangeForRendered(runs, 90, 99)).toBeNull();
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
    const line = restoreLine(nextWorkBlock(display, delIdx), cut.split("\n").length);
    // undefined = the working copy round-tripped back to the submitted revision
    const restored = restoreBlock(BASE, cut, li, line);
    expect(restored).toBeUndefined();
    expect(buildDisplay(BASE, restored).every((d) => d.type === "same")).toBe(true);
  });
});
