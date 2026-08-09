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
} from "./view-plan";
import { cutBlock, parseBlocks, restoreBlock, restoreLine, type Annotation } from "@cueloop/schema";

const BASE = `# Plan

## Context

The daemon persists sessions to disk atomically.

- first item
- second item
`;

describe("buildDisplay reconciliation", () => {
  test("no working copy: everything is same", () => {
    const display = buildDisplay(BASE);
    expect(display.every((block) => block.type === "same")).toBe(true);
  });

  test("reworded block pairs as mod (similar)", () => {
    const working = BASE.replace("persists sessions to disk", "writes sessions to disk");
    const display = buildDisplay(BASE, working);
    const mod = display.find((block) => block.type === "mod")!;
    expect(mod.base!.text).toContain("persists");
    expect(mod.work!.text).toContain("writes");
  });

  test("unrelated cut + insert do NOT merge into a mod", () => {
    const working = BASE.replace("- second item\n", "") + "\nA totally new closing note.\n";
    const display = buildDisplay(BASE, working);
    expect(display.some((block) => block.type === "del" && block.base!.text === "second item")).toBe(true);
    expect(display.some((block) => block.type === "add" && block.work!.text.includes("closing note"))).toBe(true);
    expect(display.some((block) => block.type === "mod")).toBe(false);
  });

  test("ordered list items get running numbers", () => {
    const display = buildDisplay("1. one\n2. two\n3. three\n");
    expect(display.map((block) => block.oliNum)).toEqual([1, 2, 3]);
  });
});

describe("blockRuns + overlayMarks", () => {
  test("mod blocks emit word-diff runs that reconstruct both sides", () => {
    const block = buildDisplay("plain old text here\n", "plain new text here\n")[0]!;
    const runs = blockRuns(block, true);
    const oldSide = runs.filter((run) => run.role !== "ins").map((run) => run.text).join("");
    const newSide = runs.filter((run) => run.role !== "del").map((run) => run.text).join("");
    expect(oldSide).toBe("plain old text here");
    expect(newSide).toBe("plain new text here");
  });

  test("marks bind to working-text offsets and skip del runs", () => {
    const block = buildDisplay("old words linger\n", "new words linger\n")[0]!;
    const runs = blockRuns(block, true);
    const marked = overlayMarks(runs, [{ start: 4, end: 9, role: "mark-comment" }]); // "words"
    const markedText = marked.filter((run) => run.role === "mark-comment").map((run) => run.text).join("");
    expect(markedText).toBe("words");
    // del run text untouched
    expect(marked.some((run) => run.role === "del" && run.text === "old")).toBe(true);
  });

  test("marks never override ins emphasis", () => {
    const block = buildDisplay("keep\n", "keep added\n")[0]!;
    const runs = overlayMarks(blockRuns(block, true), [{ start: 0, end: 10, role: "mark-comment" }]);
    expect(runs.some((run) => run.role === "ins")).toBe(true);
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
    const [displayIndex, marks] = [...map.entries()][0]!;
    expect(displayText(display[displayIndex]!)).toContain("atomically");
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
    const block = buildDisplay("alpha beta gamma\n")[0]!;
    const runs = blockRuns(block, true);
    expect(renderedOffsetFor(runs, 6)).toBe(6);
    expect(workRangeForRendered(runs, 6, 10)).toEqual({ start: 6, end: 10 });
  });

  test("inline del runs shift rendered offsets in word-diffed blocks", () => {
    // rendered: "old new words linger" - "old " is a del run without offsets
    const block = buildDisplay("old words linger\n", "new words linger\n")[0]!;
    const runs = blockRuns(block, true);
    const workText = displayText(block);
    const wordsAt = workText.indexOf("words");
    const rendered = renderedOffsetFor(runs, wordsAt)!;
    const renderedText = runs.map((run) => run.text).join("");
    expect(renderedText.slice(rendered, rendered + "words".length)).toBe("words");
    // reading a rendered selection over "words" recovers the work range
    expect(workRangeForRendered(runs, rendered, rendered + "words".length)).toEqual({
      start: wordsAt,
      end: wordsAt + "words".length,
    });
  });

  test("a rendered selection spanning a del run keeps only positioned text", () => {
    const block = buildDisplay("old words\n", "new words\n")[0]!;
    const runs = blockRuns(block, true);
    const renderedText = runs.map((run) => run.text).join("");
    // select everything rendered: the work range is the whole work text
    const range = workRangeForRendered(runs, 0, renderedText.length)!;
    expect(displayText(block).slice(range.start, range.end)).toBe(displayText(block));
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
    const listItem = blocks.find((candidate) => candidate.text === "second item")!;
    const cut = cutBlock(BASE, listItem);
    expect(cut).not.toContain("second item");
    const display = buildDisplay(BASE, cut);
    const deletedIndex = display.findIndex((block) => block.type === "del");
    const line = restoreLine(nextWorkBlock(display, deletedIndex), cut.split("\n").length);
    // undefined = the working copy round-tripped back to the submitted revision
    const restored = restoreBlock(BASE, cut, listItem, line);
    expect(restored).toBeUndefined();
    expect(buildDisplay(BASE, restored).every((block) => block.type === "same")).toBe(true);
  });
});
