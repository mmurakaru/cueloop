import { describe, expect, test } from "bun:test";
import {
  isCollapsed,
  isDoubleClick,
  nextWordStart,
  orderedSpan,
  positionAt,
  previousWordStart,
  snapSpanToWords,
  snapToWords,
  spanRangeInBlock,
  tightenSpan,
  wordRangeAt,
  type LineGeometry,
} from "./thread-selection";

const TEXT = "All persistence lives in a new module.";
const BULLET = "store.ts - the store";
// block 3 wraps onto two rows, a blank row, then bullet block 4 on one row
const LINES: LineGeometry[] = [
  { blockIndex: 3, start: 0, end: 21, x: 4, y: 10 },
  { blockIndex: 3, start: 22, end: 38, x: 4, y: 11 },
  { blockIndex: 4, start: 0, end: 20, x: 6, y: 13 },
];
const textLengthOf = (blockIndex: number): number =>
  blockIndex === 3 ? TEXT.length : BULLET.length;

describe("positionAt", () => {
  test("maps a cell inside a line to the character under it", () => {
    // Act
    const position = positionAt(LINES, 4 + 6, 10);

    // Assert: column 6 of the first line is the "r" in "persistence"
    expect(position).toEqual({ blockIndex: 3, char: 6 });
    expect(TEXT[6]).toBe("r");
  });

  test("past the right edge resolves to the position after the line's last char", () => {
    // Assert
    expect(positionAt(LINES, 90, 10)).toEqual({ blockIndex: 3, char: 21 });
  });

  test("a row without text resolves to the end of the closest line above", () => {
    // Assert: the blank row between the blocks, and a row below everything
    expect(positionAt(LINES, 30, 12)).toEqual({ blockIndex: 3, char: 38 });
    expect(positionAt(LINES, 30, 40)).toEqual({ blockIndex: 4, char: 20 });
  });

  test("rows above all text resolve to the first character", () => {
    // Assert
    expect(positionAt(LINES, 30, 2)).toEqual({ blockIndex: 3, char: 0 });
  });

  test("a row of another block maps into that block", () => {
    // Act
    const position = positionAt(LINES, 6 + 3, 13);

    // Assert
    expect(position).toEqual({ blockIndex: 4, char: 3 });
    expect(positionAt([], 5, 10)).toBeNull();
  });
});

describe("orderedSpan and tightenSpan", () => {
  test("a backward drag normalizes to document order", () => {
    // Act
    const span = orderedSpan({
      anchor: { blockIndex: 4, char: 5 },
      head: { blockIndex: 3, char: 6 },
    });

    // Assert
    expect(span).toEqual({
      start: { blockIndex: 3, char: 6 },
      end: { blockIndex: 4, char: 5 },
    });
  });

  test("a collapsed selection is no span", () => {
    // Arrange
    const selection = {
      anchor: { blockIndex: 3, char: 6 },
      head: { blockIndex: 3, char: 6 },
    };

    // Assert
    expect(isCollapsed(selection)).toBe(true);
    expect(orderedSpan(selection)).toBeNull();
  });

  test("a span opening at a block's end moves onto the next block", () => {
    // Act: the pointer sat on the blank row above the bullet when the press landed
    const tightened = tightenSpan(
      {
        start: { blockIndex: 3, char: TEXT.length },
        end: { blockIndex: 4, char: 5 },
      },
      textLengthOf,
    );

    // Assert
    expect(tightened).toEqual({
      start: { blockIndex: 4, char: 0 },
      end: { blockIndex: 4, char: 5 },
    });
  });

  test("a span closing at a block's start moves back onto the previous block", () => {
    // Act
    const tightened = tightenSpan(
      { start: { blockIndex: 3, char: 10 }, end: { blockIndex: 4, char: 0 } },
      textLengthOf,
    );

    // Assert
    expect(tightened).toEqual({
      start: { blockIndex: 3, char: 10 },
      end: { blockIndex: 3, char: TEXT.length },
    });
  });

  test("a span with nothing left in it is null", () => {
    // Assert
    expect(
      tightenSpan(
        {
          start: { blockIndex: 3, char: TEXT.length },
          end: { blockIndex: 4, char: 0 },
        },
        textLengthOf,
      ),
    ).toBeNull();
  });
});

describe("spanRangeInBlock", () => {
  const span = {
    start: { blockIndex: 3, char: 22 },
    end: { blockIndex: 5, char: 4 },
  };

  test("the first block runs from the start to its end, middles fully, the last to the end char", () => {
    // Assert
    expect(spanRangeInBlock(span, 3, TEXT.length)).toEqual({
      start: 22,
      end: TEXT.length,
    });
    expect(spanRangeInBlock(span, 4, BULLET.length)).toEqual({
      start: 0,
      end: BULLET.length,
    });
    expect(spanRangeInBlock(span, 5, 30)).toEqual({ start: 0, end: 4 });
  });

  test("blocks outside the span have no range", () => {
    // Assert
    expect(spanRangeInBlock(span, 2, 10)).toBeNull();
    expect(spanRangeInBlock(span, 6, 10)).toBeNull();
  });
});

describe("word rules", () => {
  test("the boundary rule attributes trailing whitespace to the preceding word", () => {
    // Assert: char 3 is the space after "All"
    expect(wordRangeAt(TEXT, 3)).toEqual({ start: 0, end: 3 });
  });

  test("snapToWords grows a partial range to whole words on both sides", () => {
    // Assert: "rsistence liv" -> "persistence lives"
    expect(snapToWords(TEXT, { start: 6, end: 19 })).toEqual({
      start: 4,
      end: 21,
    });
  });

  test("snapSpanToWords snaps each end of a cross-block span within its own block", () => {
    // Act: "rsistence ... st" -> "persistence ... store.ts"
    const snapped = snapSpanToWords(
      { start: { blockIndex: 3, char: 6 }, end: { blockIndex: 4, char: 2 } },
      (blockIndex) => (blockIndex === 3 ? TEXT : BULLET),
    );

    // Assert
    expect(snapped).toEqual({
      start: { blockIndex: 3, char: 4 },
      end: { blockIndex: 4, char: 8 },
    });
  });

  test("word starts step in both directions and stop at the ends", () => {
    // Assert
    expect(nextWordStart(TEXT, 0)).toBe(4);
    expect(nextWordStart(TEXT, 31)).toBeNull();
    expect(previousWordStart(TEXT, 22)).toBe(16);
    expect(previousWordStart(TEXT, 0)).toBeNull();
  });
});

describe("isDoubleClick", () => {
  test("same cell within the window counts, a moved or late press does not", () => {
    // Arrange
    const first = { time: 1000, x: 5, y: 7 };

    // Assert
    expect(isDoubleClick(first, { time: 1300, x: 5, y: 7 })).toBe(true);
    expect(isDoubleClick(first, { time: 1300, x: 6, y: 7 })).toBe(false);
    expect(isDoubleClick(first, { time: 1500, x: 5, y: 7 })).toBe(false);
    expect(isDoubleClick(null, { time: 1300, x: 5, y: 7 })).toBe(false);
  });
});
