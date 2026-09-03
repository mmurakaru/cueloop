/**
 * The marking-feel harness: drives real mouse events through the virtual
 * terminal and reads the PAINTED highlight back from styled spans, so it
 * measures what the reviewer sees - which characters carry the mark, and how
 * many frames / milliseconds after each drag step they appear. Character
 * precision, backward drags, multi-line drags, and double-click word mode are
 * all asserted on the frame, not on internal state.
 */

import { afterEach, beforeEach, describe, expect, mock, test, type Mock } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { TextAttributes } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { DEFAULT_QUICK_ACTIONS } from "../config";
import { settle, typeText } from "../test-support";
import { buildDisplay, marksByDisplay } from "../view-plan";
import { makeAnchor, parseBlocks, type Annotation } from "@cueloop/schema";
import type { TextSpan } from "../thread-selection";
import { fixturePlanSession } from "./story-fixtures";
import { ThreadView } from "./ThreadView";

const PARAGRAPH =
  "The daemon persists sessions to disk atomically through a temp file and a rename so that a crash never leaves a torn document behind.";
/** A paragraph with hard source line breaks: one terminal row per source line. */
const STANZA_ROWS = [
  "Sessions are written as one JSON document per",
  "session, through a temp file and an atomic rename,",
  "so a crash can never leave a torn file on disk.",
];
const STANZA = STANZA_ROWS.join("\n");
const BULLETS = ["store.ts - the SessionStore class", "schema.ts - the on-disk record shape"];
const PLAN = `# Plan\n\n${PARAGRAPH}\n\n${STANZA}\n\n- ${BULLETS[0]}\n- ${BULLETS[1]}\n`;
/** Display block indices: title, paragraph, stanza, two bullets. */
const STANZA_BLOCK = 2;
const FIRST_BULLET_BLOCK = 3;
/** The mark backdrop the dark palette paints under selected text. */
const MARK_RGB = [70, 56, 82];
/** The idle caret cell of the dark palette. */
const CARET_RGB = [86, 91, 104];

type AnnotateHandler = (span: TextSpan, body: string) => void;
type ReplyHandler = (rootAnnotationId: string, body: string) => void;

let setup: TestRendererSetup;
let annotate: Mock<AnnotateHandler>;
let reply: Mock<ReplyHandler>;

function session(annotations: Annotation[] = []) {
  return fixturePlanSession({
    artifact: {
      type: "plan",
      content: PLAN,
      meta: { title: "Plan", planPath: "plan.md" },
    },
    annotations,
  });
}

async function mount(annotations: Annotation[] = []): Promise<void> {
  annotate = mock<AnnotateHandler>(() => {});
  reply = mock<ReplyHandler>(() => {});
  const display = buildDisplay(PLAN, undefined);

  setup = await testRender(
    <ThreadView
      session={session(annotations)}
      display={display}
      marks={marksByDisplay(annotations, display)}
      quickActions={DEFAULT_QUICK_ACTIONS}
      observer={false}
      onAnnotate={annotate}
      onReply={reply}
      onUpdateAnnotation={() => {}}
      onExit={() => {}}
    />,
    { width: 64, height: 24 },
  );
  await settle(setup);
  await settle(setup);
}

/** Rows with their concatenated mark-highlighted text (empty when none). */
function highlightedByRow(): Map<number, string> {
  const rows = new Map<number, string>();
  const frame = setup.captureSpans();

  frame.lines.forEach((line, rowIndex) => {
    let marked = "";

    for (const span of line.spans) {
      const [red, green, blue] = span.bg.toInts();
      const backdrop = red === MARK_RGB[0] && green === MARK_RGB[1] && blue === MARK_RGB[2];
      const caretCell = red === CARET_RGB[0] && green === CARET_RGB[1] && blue === CARET_RGB[2];
      // the caret cell shows through a mark; the underline says it is still marked
      const underlined = (span.attributes & TextAttributes.UNDERLINE) !== 0;

      if (backdrop || (caretCell && underlined)) marked += span.text;
    }
    if (marked.length > 0) rows.set(rowIndex, marked);
  });

  return rows;
}

function highlightedText(): string {
  return [...highlightedByRow().values()].join("");
}

/** Every painted caret cell as (row, column, character). */
function caretCells(): Array<{ row: number; column: number; text: string }> {
  const cells: Array<{ row: number; column: number; text: string }> = [];

  setup.captureSpans().lines.forEach((line, row) => {
    let column = 0;

    for (const span of line.spans) {
      const [red, green, blue] = span.bg.toInts();

      if (red === CARET_RGB[0] && green === CARET_RGB[1] && blue === CARET_RGB[2]) {
        cells.push({ row, column, text: span.text });
      }
      column += span.width;
    }
  });

  return cells;
}

/** The highlighted rows read as one string, the way the source reads across its line breaks. */
function highlightedAcrossRows(): string {
  return [...highlightedByRow().values()].join(" ");
}

/** The stanza's char offset of a column on one of its rows. */
function stanzaOffset(rowIndex: number, column: number): number {
  return STANZA_ROWS.slice(0, rowIndex).reduce((total, row) => total + row.length + 1, 0) + column;
}

/** Column of a word on a row, from the char frame. */
function locate(needle: string) {
  const rows = setup.captureCharFrame().split("\n");
  const row = rows.findIndex((line) => line.includes(needle));

  expect(row, `"${needle}" not on screen`).toBeGreaterThanOrEqual(0);

  return { row, column: rows[row]!.indexOf(needle) };
}

/**
 * Render frames until the highlight equals `expected`, returning how many
 * frames it took - the feel metric: 1 means the very next frame after the
 * event already carries the mark.
 */
async function framesUntilHighlight(expected: string, limit = 4): Promise<number> {
  for (let frame = 1; frame <= limit; frame++) {
    // one scheduler turn (the input parser and React commit), then one frame
    await new Promise((resolve) => setTimeout(resolve, 0));
    await setup.renderOnce();
    if (highlightedText() === expected) return frame;
  }

  throw new Error(`highlight never became "${expected}"; last: "${highlightedText()}"`);
}

beforeEach(async () => {
  await mount();
});
afterEach(() => {
  setup.renderer.destroy();
});

describe("marking feel", () => {
  test("a drag from mid-word paints a character-precise selection within one frame per step", async () => {
    // Arrange: press inside "daemon" (on the "e"), not at a word boundary
    const { row, column } = locate("daemon");
    const pressColumn = column + 2;

    await setup.mockMouse.pressDown(pressColumn, row);
    await settle(setup);

    // Act + Assert: each step to the right extends the mark by exactly one
    // character, and the mark is painted by the next frame
    const latencies: number[] = [];
    const frames: number[] = [];

    for (let step = 1; step <= 8; step++) {
      const started = performance.now();

      await setup.mockMouse.moveTo(pressColumn + step, row);
      frames.push(await framesUntilHighlight(PARAGRAPH.slice(6, 6 + step)));
      latencies.push(performance.now() - started);
    }
    await setup.mockMouse.release(pressColumn + 8, row);

    expect(highlightedText()).toBe("emon per");
    expect(Math.max(...frames)).toBe(1);
    const sorted = latencies.toSorted((left, right) => left - right);

    console.log(
      `drag step latency p50 ${sorted[Math.floor(sorted.length / 2)]!.toFixed(
        2,
      )}ms p95 ${sorted[sorted.length - 1]!.toFixed(2)}ms`,
    );
  });

  test("a backward drag normalizes to the same characters", async () => {
    // Arrange: press at the "s" of "persists", drag left into "daemon"
    const { row, column } = locate("persists");

    await setup.mockMouse.pressDown(column + 3, row);
    await settle(setup);

    // Act
    await setup.mockMouse.moveTo(column - 4, row);
    await settle(setup);
    await setup.mockMouse.release(column - 4, row);

    // Assert: "mon per" - partial words on both ends, ordered start->end
    expect(highlightedText()).toBe("mon per");
  });

  test("dragging onto the next visual line selects across the wrap", async () => {
    // Arrange: the paragraph wraps at 64 columns; press on line one
    const first = locate("atomically");
    const second = locate("crash");

    expect(second.row).toBe(first.row + 1);
    await setup.mockMouse.pressDown(first.column, first.row);
    await settle(setup);

    // Act: drag down onto the second line
    await setup.mockMouse.moveTo(second.column + 5, second.row);
    await settle(setup);

    // Assert: both rows carry highlight, and together they read as the text
    // between the two positions (minus the wrap's dropped space)
    const rows = highlightedByRow();

    expect(rows.size).toBe(2);
    const joined = [...rows.values()].join(" ");
    const start = PARAGRAPH.indexOf("atomically");
    const end = PARAGRAPH.indexOf("crash") + 5;

    expect(joined).toBe(PARAGRAPH.slice(start, end));
  });

  test("dragging past the right edge selects to the line end", async () => {
    // Arrange
    const { row, column } = locate("torn");

    await setup.mockMouse.pressDown(column, row);
    await settle(setup);

    // Act: far past the text
    await setup.mockMouse.moveTo(63, row);
    await settle(setup);

    // Assert
    expect(highlightedText()).toBe("torn document behind.");
  });

  test("double-click selects the whole word under the pointer", async () => {
    // Arrange + Act
    const { row, column } = locate("sessions");

    await setup.mockMouse.doubleClick(column + 3, row);
    await settle(setup);

    // Assert
    expect(highlightedText()).toBe("sessions");
  });

  test("backspace on an empty draft undoes it, keeps the selection, and typing re-opens it", async () => {
    // Arrange: mark "emon per" and start a draft
    const { row, column } = locate("daemon");

    await setup.mockMouse.drag(column + 2, row, column + 10, row);
    await settle(setup);
    await typeText(setup, "x");
    expect(setup.captureCharFrame()).toContain("● x");

    // Act: delete the only character - the card must stay, now empty
    setup.mockInput.pressKey("BACKSPACE");
    await settle(setup);
    await settle(setup);

    // Assert
    expect(setup.captureCharFrame()).toContain("●");
    expect(setup.captureCharFrame()).not.toContain("● x");

    // Act: backspace again on the empty draft
    setup.mockInput.pressKey("BACKSPACE");
    await settle(setup);
    await settle(setup);

    // Assert: the card is gone, the selection is still painted
    expect(setup.captureCharFrame()).not.toContain("●");
    expect(highlightedText()).toBe("emon per");

    // Act + Assert: typing again re-opens a draft on the same selection
    await typeText(setup, "y");
    expect(setup.captureCharFrame()).toContain("● y");
    expect(highlightedText()).toBe("emon per");
  });

  test("typing after a partial-word drag anchors the comment to exactly those characters", async () => {
    // Arrange: mark "emon per"
    const { row, column } = locate("daemon");

    await setup.mockMouse.drag(column + 2, row, column + 10, row);
    await settle(setup);
    expect(highlightedText()).toBe("emon per");

    // Act: type and send
    await typeText(setup, "partial");
    setup.mockInput.pressKey("RETURN", { meta: true });
    await settle(setup);

    // Assert: the annotation span is the exact partial selection
    expect(annotate).toHaveBeenCalledTimes(1);
    const [span, body] = annotate.mock.calls[0]!;

    expect(span).toEqual({
      start: { blockIndex: 1, char: 6 },
      end: { blockIndex: 1, char: 14 },
    });
    expect(PARAGRAPH.slice(span.start.char, span.end.char)).toBe("emon per");
    expect(body).toBe("partial");
  });
});

describe("marking across rows", () => {
  /** Row and left column of the stanza on screen. */
  function stanzaOrigin() {
    const { row, column } = locate(STANZA_ROWS[0]!);

    for (const [index, text] of STANZA_ROWS.entries()) {
      expect(setup.captureCharFrame().split("\n")[row + index]).toContain(text);
    }

    return { row, column };
  }

  test("a drag onto the row below marks exactly two rows, to the character under the pointer", async () => {
    // Arrange: press inside "written" on row one (source line one)
    const origin = stanzaOrigin();
    const pressColumn = STANZA_ROWS[0]!.indexOf("written") + 3;
    const headColumn = STANZA_ROWS[1]!.indexOf("temp") + 2;

    await setup.mockMouse.pressDown(origin.column + pressColumn, origin.row);
    await settle(setup);

    // Act: one row down, inside "temp"
    await setup.mockMouse.moveTo(origin.column + headColumn, origin.row + 1);
    await settle(setup);

    // Assert: two rows, the second ending mid-word under the pointer
    const rows = highlightedByRow();

    expect([...rows.keys()]).toEqual([origin.row, origin.row + 1]);
    expect(highlightedAcrossRows()).toBe(
      STANZA.slice(stanzaOffset(0, pressColumn), stanzaOffset(1, headColumn)).replace("\n", " "),
    );
    expect(rows.get(origin.row + 1)).toBe("session, through a te");
  });

  test("moving down a row then back up shrinks the mark again", async () => {
    // Arrange
    const origin = stanzaOrigin();
    const pressColumn = 4;

    await setup.mockMouse.pressDown(origin.column + pressColumn, origin.row);
    await settle(setup);

    // Act: two rows down, then back to one
    await setup.mockMouse.moveTo(origin.column + 10, origin.row + 2);
    await settle(setup);
    expect(highlightedByRow().size).toBe(3);
    await setup.mockMouse.moveTo(origin.column + 10, origin.row + 1);
    await settle(setup);

    // Assert
    const rows = highlightedByRow();

    expect(rows.size).toBe(2);
    expect(rows.get(origin.row + 1)).toBe("session, t");
  });

  test("a backward drag up two rows normalizes to the same characters", async () => {
    // Arrange: press inside "crash" on row three
    const origin = stanzaOrigin();
    const pressColumn = STANZA_ROWS[2]!.indexOf("crash") + 2;
    const headColumn = STANZA_ROWS[0]!.indexOf("JSON");

    await setup.mockMouse.pressDown(origin.column + pressColumn, origin.row + 2);
    await settle(setup);

    // Act: drag up to the "J" of "JSON"
    await setup.mockMouse.moveTo(origin.column + headColumn, origin.row);
    await settle(setup);

    // Assert
    expect(highlightedAcrossRows()).toBe(
      STANZA.slice(stanzaOffset(0, headColumn), stanzaOffset(2, pressColumn)).replaceAll("\n", " "),
    );
    expect(highlightedByRow().get(origin.row + 2)).toBe("so a cr");
  });

  test("dragging below all text marks through to the document's last character", async () => {
    // Arrange: press on the stanza's last row
    const origin = stanzaOrigin();
    const pressColumn = STANZA_ROWS[2]!.indexOf("torn");

    await setup.mockMouse.pressDown(origin.column + pressColumn, origin.row + 2);
    await settle(setup);

    // Act: a row below everything, past the right edge
    await setup.mockMouse.moveTo(63, origin.row + 8);
    await settle(setup);

    // Assert: the stanza tail and both bullets
    const rows = highlightedByRow();

    expect(rows.get(origin.row + 2)).toBe("torn file on disk.");
    expect(rows.get(origin.row + 4)).toBe(BULLETS[0]);
    expect(rows.get(origin.row + 6)).toBe(BULLETS[1]);
    expect(rows.size).toBe(3);
  });

  test("dragging above all text marks back from the document's first character", async () => {
    // Arrange: press on the paragraph's first row
    const { row, column } = locate("daemon");

    await setup.mockMouse.pressDown(column, row);
    await settle(setup);

    // Act: the padding row above the title
    await setup.mockMouse.moveTo(30, 0);
    await settle(setup);

    // Assert: the title and the paragraph head
    const rows = highlightedByRow();

    expect(rows.get(locate("Plan").row)).toBe("Plan");
    expect(rows.get(row)).toBe("The ");
    expect(rows.size).toBe(2);
  });

  test("a press and release on the same cell marks nothing", async () => {
    // Arrange + Act
    const origin = stanzaOrigin();

    await setup.mockMouse.pressDown(origin.column + 12, origin.row + 1);
    await settle(setup);
    await setup.mockMouse.release(origin.column + 12, origin.row + 1);
    await settle(setup);

    // Assert
    expect(highlightedByRow().size).toBe(0);
  });
});

describe("marking across blocks", () => {
  /** Screen row and left column of a text on screen, asserting it is there. */
  function rowOf(text: string) {
    return locate(text);
  }

  test("a drag from a paragraph into the bullet below marks the tail and the head, not the gap", async () => {
    // Arrange: press inside "torn" on the stanza's last row
    const torn = rowOf("torn file");
    const bullet = rowOf(BULLETS[0]!);

    expect(bullet.row).toBe(torn.row + 2);
    await setup.mockMouse.pressDown(torn.column, torn.row);
    await settle(setup);

    // Act: onto "Session" in the first bullet
    await setup.mockMouse.moveTo(bullet.column + BULLETS[0]!.indexOf("Session") + 7, bullet.row);
    await settle(setup);

    // Assert: two rows, the blank row between them untouched
    const rows = highlightedByRow();

    expect([...rows.keys()]).toEqual([torn.row, bullet.row]);
    expect(rows.get(torn.row)).toBe("torn file on disk.");
    expect(rows.get(bullet.row)).toBe("store.ts - the Session");
  });

  test("a drag across two bullets marks both", async () => {
    // Arrange
    const first = rowOf(BULLETS[0]!);
    const second = rowOf(BULLETS[1]!);

    await setup.mockMouse.pressDown(first.column + "store.ts - ".length, first.row);
    await settle(setup);

    // Act
    await setup.mockMouse.moveTo(second.column + "schema.ts".length, second.row);
    await settle(setup);

    // Assert
    const rows = highlightedByRow();

    expect(rows.get(first.row)).toBe("the SessionStore class");
    expect(rows.get(second.row)).toBe("schema.ts");
    expect(rows.size).toBe(2);
  });

  test("the pointer on the blank row below a block marks to that block's end only", async () => {
    // Arrange
    const torn = rowOf("torn file");

    await setup.mockMouse.pressDown(torn.column, torn.row);
    await settle(setup);

    // Act
    await setup.mockMouse.moveTo(10, torn.row + 1);
    await settle(setup);

    // Assert
    expect(highlightedByRow().size).toBe(1);
    expect(highlightedText()).toBe("torn file on disk.");
  });

  test("a backward drag from a bullet up into the paragraph normalizes across the blocks", async () => {
    // Arrange: press after "store.ts" and drag up into "disk"
    const bullet = rowOf(BULLETS[0]!);
    const disk = rowOf("disk.");

    await setup.mockMouse.pressDown(bullet.column + "store.ts".length, bullet.row);
    await settle(setup);

    // Act
    await setup.mockMouse.moveTo(disk.column, disk.row);
    await settle(setup);

    // Assert
    const rows = highlightedByRow();

    expect(rows.get(disk.row)).toBe("disk.");
    expect(rows.get(bullet.row)).toBe("store.ts");
    expect(rows.size).toBe(2);
  });

  test("typing after a cross-block drag comments on the span and the card sits under its last block", async () => {
    // Arrange
    const torn = rowOf("torn file");
    const bullet = rowOf(BULLETS[0]!);

    await setup.mockMouse.drag(torn.column, torn.row, bullet.column + 8, bullet.row);
    await settle(setup);

    // Act
    await typeText(setup, "one comment for both");
    const frame = setup.captureCharFrame().split("\n");
    const cardRow = frame.findIndex((line) => line.includes("● one comment for both"));

    // Assert: the draft card renders below the bullet, not below the paragraph
    expect(cardRow).toBeGreaterThan(bullet.row);
    expect(frame.slice(torn.row + 1, bullet.row + 1).join("\n")).not.toContain("●");

    // Act: send
    setup.mockInput.pressKey("RETURN", { meta: true });
    await settle(setup);

    // Assert
    expect(annotate).toHaveBeenCalledTimes(1);
    const [span, body] = annotate.mock.calls[0]!;

    expect(span).toEqual({
      start: { blockIndex: STANZA_BLOCK, char: STANZA.indexOf("torn") },
      end: { blockIndex: FIRST_BULLET_BLOCK, char: 8 },
    });
    expect(body).toBe("one comment for both");
  });

  test("a saved spanning comment paints every block it covers and renders one card", async () => {
    // Arrange: an anchor from "torn" to "store.ts", as the daemon would hold it
    setup.renderer.destroy();
    const blocks = parseBlocks(PLAN);
    const anchor = makeAnchor(blocks, STANZA_BLOCK, STANZA.indexOf("torn"), 8, FIRST_BULLET_BLOCK);

    await mount([
      {
        id: "span_1",
        kind: "comment",
        anchor,
        body: "both at once",
        createdAt: "2026-09-01T10:00:00Z",
      },
    ]);

    // Assert
    const rows = highlightedByRow();
    const torn = rowOf("torn file");
    const bullet = rowOf(BULLETS[0]!);

    expect(rows.get(torn.row)).toBe("torn file on disk.");
    expect(rows.get(bullet.row)).toBe("store.ts");
    expect(rows.size).toBe(2);
    const frame = setup.captureCharFrame();

    expect(frame.split("● both at once").length - 1).toBe(1);
    expect(frame.split("\n").findIndex((line) => line.includes("● both at once"))).toBeGreaterThan(
      bullet.row,
    );
  });
});

describe("marks stay put around cards", () => {
  const seeded: Annotation[] = [
    {
      id: "own_1",
      kind: "comment",
      anchor: makeAnchor(
        parseBlocks(PLAN),
        1,
        PARAGRAPH.indexOf("persists"),
        PARAGRAPH.indexOf("persists") + "persists".length,
      ),
      body: "which daemon?",
      createdAt: "2026-09-01T10:00:00Z",
    },
  ];

  beforeEach(async () => {
    setup.renderer.destroy();
    await mount(seeded);
  });

  test("clicking a card after placing the caret in another block marks nothing new", async () => {
    // Arrange: a bare caret inside the first bullet
    const bullet = locate(BULLETS[0]!);
    const card = locate("● which daemon?");

    await setup.mockMouse.click(bullet.column + 20, bullet.row);
    await settle(setup);
    expect(highlightedText()).toBe("persists");

    // Act: focus the card, which lives under the paragraph
    await setup.mockMouse.click(card.column + 4, card.row);
    await settle(setup);
    await settle(setup);

    // Assert: only the thread's own mark is painted
    expect(highlightedByRow().size).toBe(1);
    expect(highlightedText()).toBe("persists");
  });

  test("dragging inside a card's text marks nothing in the document", async () => {
    // Arrange
    const bullet = locate(BULLETS[0]!);
    const card = locate("● which daemon?");

    await setup.mockMouse.click(bullet.column + 20, bullet.row);
    await settle(setup);

    // Act: a drag across the comment text
    await setup.mockMouse.drag(card.column + 2, card.row, card.column + 12, card.row);
    await settle(setup);
    await settle(setup);

    // Assert
    expect(highlightedText()).toBe("persists");
  });

  test("jumping to a discussion with cmd+] after placing the caret elsewhere marks nothing new", async () => {
    // Arrange
    const bullet = locate(BULLETS[1]!);

    await setup.mockMouse.click(bullet.column + 5, bullet.row);
    await settle(setup);

    // Act
    setup.mockInput.pressKey("]", { meta: true });
    await settle(setup);
    await settle(setup);

    // Assert
    expect(highlightedText()).toBe("persists");
  });
});

describe("the idle caret cell", () => {
  test("a click paints one steady caret cell under the pointer", async () => {
    // Arrange + Act
    const { row, column } = locate("sessions");

    await setup.mockMouse.click(column + 2, row);
    await settle(setup);

    // Assert
    expect(caretCells()).toEqual([{ row, column: column + 2, text: "s" }]);
  });

  test("after a forward drag the caret cell sits right after the mark", async () => {
    // Arrange + Act: mark "emon per"
    const { row, column } = locate("daemon");

    await setup.mockMouse.drag(column + 2, row, column + 10, row);
    await settle(setup);

    // Assert: the mark is intact and the cell after it is the caret
    expect(highlightedText()).toBe("emon per");
    expect(caretCells()).toEqual([{ row, column: column + 10, text: "s" }]);
  });

  test("after a backward drag the caret cell shows through the mark's first character", async () => {
    // Arrange + Act
    const { row, column } = locate("daemon");

    await setup.mockMouse.drag(column + 10, row, column + 2, row);
    await settle(setup);

    // Assert
    expect(highlightedText()).toBe("emon per");
    expect(caretCells()).toEqual([{ row, column: column + 2, text: "e" }]);
  });

  test("an open card takes the cursor: no caret cell and no placeholder in the text", async () => {
    // Arrange
    const { row, column } = locate("daemon");

    await setup.mockMouse.click(column + 2, row);
    await settle(setup);
    expect(caretCells()).toHaveLength(1);

    // Act
    await typeText(setup, "x");

    // Assert
    expect(caretCells()).toHaveLength(0);
    expect(setup.captureCharFrame()).not.toContain("comment...");
  });
});

describe("discussion identity", () => {
  const blocks = parseBlocks(PLAN);
  const rootAnchor = makeAnchor(
    blocks,
    1,
    PARAGRAPH.indexOf("persists"),
    PARAGRAPH.indexOf("persists") + "persists".length,
  );
  const root: Annotation = {
    id: "root",
    kind: "comment",
    anchor: rootAnchor,
    body: "which daemon?",
    createdAt: "2026-09-01T10:00:00Z",
  };

  test("a reply joins its root comment's card by replyTo, and a same-span legacy note still groups", async () => {
    // Arrange
    setup.renderer.destroy();
    await mount([
      root,
      {
        id: "reply",
        kind: "comment",
        anchor: rootAnchor,
        body: "the local one",
        author: "SHA256:ana",
        replyTo: "root",
        createdAt: "2026-09-01T10:01:00Z",
      },
      {
        id: "legacy",
        kind: "comment",
        anchor: rootAnchor,
        body: "same span, no reply link",
        author: "SHA256:bob",
        createdAt: "2026-09-01T09:59:00Z",
      },
    ]);

    // Assert: one card, voices in time order
    const rows = setup.captureCharFrame().split("\n");
    const voices = rows
      .map((row) => row.match(/│ ([●○] .*?)\s+│/)?.[1])
      .filter((voice): voice is string => voice !== undefined);

    expect(voices).toEqual(["○ same span, no reply link", "● which daemon?", "○ the local one"]);
  });

  test("enter on a discussion replies to its root comment", async () => {
    // Arrange
    setup.renderer.destroy();
    await mount([root]);
    const card = locate("● which daemon?");

    await setup.mockMouse.click(card.column + 4, card.row);
    await settle(setup);

    // Act
    setup.mockInput.pressKey("RETURN");
    await settle(setup);
    await typeText(setup, "agreed");
    setup.mockInput.pressKey("RETURN", { meta: true });
    await settle(setup);

    // Assert
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]).toEqual(["root", "agreed"]);
    expect(annotate).not.toHaveBeenCalled();
  });
});
