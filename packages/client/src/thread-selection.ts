/**
 * The thread view's text-selection model: a pure, renderer-free description
 * of where the caret is and what is marked, plus the hit-testing that maps a
 * pointer cell onto a character. Character-precise (partial words), spanning
 * wrapped lines and consecutive blocks, normalized for backward drags. Word snapping
 * happens only where the grammar asks for it: the typing anchor for a bare
 * caret, and double-click word mode.
 *
 * Isolated on purpose: the interaction can be unit-tested and benchmarked
 * without a terminal, and the view layer only wires events to it.
 */

export interface TextPosition {
  blockIndex: number;
  char: number;
}

/** Where one visual line of a block sits on screen, in cells. */
export interface LineGeometry {
  blockIndex: number;
  /** Char range of the block's text this line shows. */
  start: number;
  end: number;
  x: number;
  y: number;
}

/** The held selection: `anchor` is where the press landed, `head` follows the pointer. */
export interface Selection {
  anchor: TextPosition;
  head: TextPosition;
}

export interface CharRange {
  start: number;
  end: number;
}

/** An ordered stretch of text, possibly across consecutive blocks. */
export interface TextSpan {
  start: TextPosition;
  end: TextPosition;
}

/** Document order: block first, then character. */
export function comparePositions(left: TextPosition, right: TextPosition): number {
  return left.blockIndex - right.blockIndex || left.char - right.char;
}

/** Word boundaries of a block's text. */
export function wordRanges(text: string): CharRange[] {
  const ranges: CharRange[] = [];
  const matcher = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return ranges;
}

/**
 * The marked word for a char offset: the word containing it, or - when the
 * caret sits in the whitespace immediately after a word - that preceding
 * word, never the next one.
 */
export function wordIndexAt(text: string, char: number): number {
  const words = wordRanges(text);

  for (let index = 0; index < words.length; index++) {
    if (char < words[index]!.start) return Math.max(0, index - 1);
    if (char < words[index]!.end) return index;
  }

  return Math.max(0, words.length - 1);
}

/** The word range the boundary rule assigns to a char offset; null for empty text. */
export function wordRangeAt(text: string, char: number): CharRange | null {
  const words = wordRanges(text);

  return words[wordIndexAt(text, char)] ?? null;
}

/**
 * Map a pointer cell to a text position over every registered line. A row
 * without text (a blank row, a card) resolves to the end of the closest line
 * above it, rows above all text to the first character, and a cell past a
 * line's last cell to the position after that line's last character, so a
 * drag that runs off the right edge still selects to the line end.
 */
export function positionAt(lines: LineGeometry[], x: number, y: number): TextPosition | null {
  if (lines.length === 0) return null;
  const ordered = lines.toSorted((left, right) => left.y - right.y || left.x - right.x);
  const onRow = ordered.find((line) => line.y === y);

  if (onRow) {
    const column = Math.max(0, Math.min(onRow.end - onRow.start, x - onRow.x));

    return { blockIndex: onRow.blockIndex, char: onRow.start + column };
  }
  const above = ordered.findLast((line) => line.y < y);

  if (above) return { blockIndex: above.blockIndex, char: above.end };
  const first = ordered[0]!;

  return { blockIndex: first.blockIndex, char: first.start };
}

/** True when nothing is held: the caret is a point, not a range. */
export function isCollapsed(selection: Selection): boolean {
  return comparePositions(selection.anchor, selection.head) === 0;
}

/** The selection in document order, or null when collapsed. */
export function orderedSpan(selection: Selection): TextSpan | null {
  if (isCollapsed(selection)) return null;

  return comparePositions(selection.anchor, selection.head) < 0
    ? { start: selection.anchor, end: selection.head }
    : { start: selection.head, end: selection.anchor };
}

/**
 * Pull a span's edges off block boundaries: opening at a block's end or
 * closing at a block's start marks nothing there, so the edge moves onto the
 * neighbouring block. Null when nothing remains.
 */
export function tightenSpan(
  span: TextSpan,
  textLengthOf: (blockIndex: number) => number,
): TextSpan | null {
  let { start, end } = span;

  while (start.blockIndex < end.blockIndex && start.char >= textLengthOf(start.blockIndex)) {
    start = { blockIndex: start.blockIndex + 1, char: 0 };
  }
  while (end.blockIndex > start.blockIndex && end.char === 0) {
    end = {
      blockIndex: end.blockIndex - 1,
      char: textLengthOf(end.blockIndex - 1),
    };
  }
  const clampedEnd = {
    blockIndex: end.blockIndex,
    char: Math.min(end.char, textLengthOf(end.blockIndex)),
  };

  return comparePositions(start, clampedEnd) < 0 ? { start, end: clampedEnd } : null;
}

/** The part of a span that falls on one block, as a char range; null when none. */
export function spanRangeInBlock(
  span: TextSpan,
  blockIndex: number,
  textLength: number,
): CharRange | null {
  if (blockIndex < span.start.blockIndex || blockIndex > span.end.blockIndex) return null;
  const start = blockIndex === span.start.blockIndex ? span.start.char : 0;
  const end = blockIndex === span.end.blockIndex ? Math.min(span.end.char, textLength) : textLength;

  return end > start ? { start, end } : null;
}

/** Grow a char range outward to the word boundaries it touches (double-click word mode). */
export function snapToWords(text: string, range: CharRange): CharRange {
  const words = wordRanges(text);
  const first = words.find((word) => range.start < word.end) ?? words[words.length - 1];
  const last = words.toReversed().find((word) => range.end > word.start) ?? words[0];

  if (!first || !last) return range;

  return {
    start: Math.min(first.start, range.start),
    end: Math.max(last.end, range.end),
  };
}

/** Snap both ends of a span to word boundaries, each within its own block. */
export function snapSpanToWords(span: TextSpan, textOf: (blockIndex: number) => string): TextSpan {
  if (span.start.blockIndex === span.end.blockIndex) {
    const snapped = snapToWords(textOf(span.start.blockIndex), {
      start: span.start.char,
      end: span.end.char,
    });

    return {
      start: { blockIndex: span.start.blockIndex, char: snapped.start },
      end: { blockIndex: span.end.blockIndex, char: snapped.end },
    };
  }
  const startText = textOf(span.start.blockIndex);
  const endText = textOf(span.end.blockIndex);

  return {
    start: {
      blockIndex: span.start.blockIndex,
      char: snapToWords(startText, {
        start: span.start.char,
        end: startText.length,
      }).start,
    },
    end: {
      blockIndex: span.end.blockIndex,
      char: snapToWords(endText, { start: 0, end: span.end.char }).end,
    },
  };
}

export interface ClickStamp {
  time: number;
  x: number;
  y: number;
}

/** Two presses on the same cell inside this window read as a double-click. */
export const DOUBLE_CLICK_WINDOW_MS = 400;

export function isDoubleClick(previous: ClickStamp | null, current: ClickStamp): boolean {
  return (
    previous !== null &&
    previous.x === current.x &&
    previous.y === current.y &&
    current.time - previous.time <= DOUBLE_CLICK_WINDOW_MS
  );
}

/** Next word start after `char`, or null past the last word. */
export function nextWordStart(text: string, char: number): number | null {
  const next = wordRanges(text).find((word) => word.start > char);

  return next ? next.start : null;
}

/** Previous word start before `char`, or null before the first word. */
export function previousWordStart(text: string, char: number): number | null {
  const previous = wordRanges(text)
    .toReversed()
    .find((word) => word.start < char);

  return previous ? previous.start : null;
}
