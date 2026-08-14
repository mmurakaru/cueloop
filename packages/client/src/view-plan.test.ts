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
    // Act
    const display = buildDisplay(BASE);

    // Assert
    expect(display.every((block) => block.type === "same")).toBe(true);
  });

  test("reworded block pairs as mod (similar)", () => {
    // Arrange
    const working = BASE.replace("persists sessions to disk", "writes sessions to disk");

    // Act
    const display = buildDisplay(BASE, working);

    // Assert
    const mod = display.find((block) => block.type === "mod")!;
    expect(mod.base!.text).toContain("persists");
    expect(mod.work!.text).toContain("writes");
  });

  test("unrelated cut + insert do NOT merge into a mod", () => {
    // Arrange
    const working = BASE.replace("- second item\n", "") + "\nA totally new closing note.\n";

    // Act
    const display = buildDisplay(BASE, working);

    // Assert
    expect(display.some((block) => block.type === "del" && block.base!.text === "second item")).toBe(true);
    expect(display.some((block) => block.type === "add" && block.work!.text.includes("closing note"))).toBe(true);
    expect(display.some((block) => block.type === "mod")).toBe(false);
  });

  test("ordered list items get running numbers", () => {
    // Act
    const display = buildDisplay("1. one\n2. two\n3. three\n");

    // Assert
    expect(display.map((block) => block.orderedItemNumber)).toEqual([1, 2, 3]);
  });
});

describe("blockRuns + overlayMarks", () => {
  test("mod blocks emit word-diff runs that reconstruct both sides", () => {
    // Arrange
    const block = buildDisplay("plain old text here\n", "plain new text here\n")[0]!;

    // Act
    const runs = blockRuns(block, true);

    // Assert
    const oldSide = runs.filter((run) => run.role !== "ins").map((run) => run.text).join("");
    const newSide = runs.filter((run) => run.role !== "del").map((run) => run.text).join("");
    expect(oldSide).toBe("plain old text here");
    expect(newSide).toBe("plain new text here");
  });

  test("marks bind to working-text offsets and skip del runs", () => {
    // Arrange
    const block = buildDisplay("old words linger\n", "new words linger\n")[0]!;
    const runs = blockRuns(block, true);

    // Act
    const marked = overlayMarks(runs, [{ start: 4, end: 9, role: "mark-comment" }]); // "words"

    // Assert
    const markedText = marked.filter((run) => run.role === "mark-comment").map((run) => run.text).join("");
    expect(markedText).toBe("words");
    // del run text untouched
    expect(marked.some((run) => run.role === "del" && run.text === "old")).toBe(true);
  });

  test("marks never override ins emphasis", () => {
    // Arrange
    const block = buildDisplay("keep\n", "keep added\n")[0]!;

    // Act
    const runs = overlayMarks(blockRuns(block, true), [{ start: 0, end: 10, role: "mark-comment" }]);

    // Assert
    expect(runs.some((run) => run.role === "ins")).toBe(true);
  });
});

describe("marksByDisplay", () => {
  test("annotations resolve into display coordinates", () => {
    // Arrange
    const working = BASE.replace("first item", "first item edited beyond recognition of it");
    const display = buildDisplay(BASE, working);
    const ann: Annotation = {
      id: "a1",
      kind: "comment",
      anchor: { quote: "atomically", prefix: "to disk ", suffix: "." },
      body: "define atomically",
      createdAt: "",
    };

    // Act
    const map = marksByDisplay([ann], display);

    // Assert
    const [displayIndex, marks] = [...map.entries()][0]!;
    expect(displayText(display[displayIndex]!)).toContain("atomically");
    expect(marks[0]!.annotationId).toBe("a1");
  });

  test("orphaned annotations produce no marks", () => {
    // Arrange
    const display = buildDisplay(BASE);
    const ann: Annotation = {
      id: "a1",
      kind: "comment",
      anchor: { quote: "text that is gone", prefix: "", suffix: "" },
      body: "",
      createdAt: "",
    };

    // Assert
    expect(marksByDisplay([ann], display).size).toBe(0);
  });
});

describe("rendered/work offset mapping", () => {
  test("plain blocks map 1:1 in both directions", () => {
    // Arrange
    const block = buildDisplay("alpha beta gamma\n")[0]!;
    const runs = blockRuns(block, true);

    // Assert
    expect(renderedOffsetFor(runs, 6)).toBe(6);
    expect(workRangeForRendered(runs, 6, 10)).toEqual({ start: 6, end: 10 });
  });

  test("inline del runs shift rendered offsets in word-diffed blocks", () => {
    // Arrange
    // rendered: "old new words linger" - "old " is a del run without offsets
    const block = buildDisplay("old words linger\n", "new words linger\n")[0]!;
    const runs = blockRuns(block, true);
    const workText = displayText(block);
    const wordsAt = workText.indexOf("words");

    // Act
    const rendered = renderedOffsetFor(runs, wordsAt)!;

    // Assert
    const renderedText = runs.map((run) => run.text).join("");
    expect(renderedText.slice(rendered, rendered + "words".length)).toBe("words");
    // reading a rendered selection over "words" recovers the work range
    expect(workRangeForRendered(runs, rendered, rendered + "words".length)).toEqual({
      start: wordsAt,
      end: wordsAt + "words".length,
    });
  });

  test("a rendered selection spanning a del run keeps only positioned text", () => {
    // Arrange
    const block = buildDisplay("old words\n", "new words\n")[0]!;
    const runs = blockRuns(block, true);
    const renderedText = runs.map((run) => run.text).join("");

    // Act
    // select everything rendered: the work range is the whole work text
    const range = workRangeForRendered(runs, 0, renderedText.length)!;

    // Assert
    expect(displayText(block).slice(range.start, range.end)).toBe(displayText(block));
  });

  test("offsets outside any positioned run map to null", () => {
    // Arrange
    const runs = blockRuns(buildDisplay("short\n")[0]!, true);

    // Assert
    expect(renderedOffsetFor(runs, 99)).toBeNull();
    expect(workRangeForRendered(runs, 90, 99)).toBeNull();
  });
});

describe("span mode", () => {
  const text = "one two three four";
  test("v selects the first word; l grows; w slides; $ to end", () => {
    // Act
    let span = startSpan(0, text)!;

    // Assert
    expect(text.slice(span.start, span.end)).toBe("one");

    // Act
    span = spanKey(span, "l", text);

    // Assert
    expect(text.slice(span.start, span.end)).toBe("one two");

    // Act
    span = spanKey(span, "w", text);

    // Assert
    expect(text.slice(span.start, span.end)).toBe("two three");

    // Act
    span = spanKey(span, "$", text);

    // Assert
    expect(text.slice(span.start, span.end)).toBe("two three four");
  });
});

describe("cut / restore round-trip", () => {
  test("cut removes the block lines; restore puts them back", () => {
    // Arrange
    const blocks = parseBlocks(BASE);
    const listItem = blocks.find((candidate) => candidate.text === "second item")!;

    // Act
    const cut = cutBlock(BASE, listItem);

    // Assert
    expect(cut).not.toContain("second item");

    // Arrange
    const display = buildDisplay(BASE, cut);
    const deletedIndex = display.findIndex((block) => block.type === "del");
    const line = restoreLine(nextWorkBlock(display, deletedIndex), cut.split("\n").length);

    // Act
    // undefined = the working copy round-tripped back to the submitted revision
    const restored = restoreBlock(BASE, cut, listItem, line);

    // Assert
    expect(restored).toBeUndefined();
    expect(buildDisplay(BASE, restored).every((block) => block.type === "same")).toBe(true);
  });
});
