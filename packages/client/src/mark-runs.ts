/**
 * Mark geometry for an annotated line of text: which stretches are marked
 * (a discussion span, a held selection) or carry the caret cell, the greedy
 * word wrap into visual lines, and the printable-key test that starts a
 * comment. Renderer-free, shared by the plan thread view and the diff sheet.
 */

import type { KeyEvent } from "@opentui/core";
import { wordRanges } from "./thread-selection";

export interface MarkRange {
  start: number;
  end: number;
  /** The bare caret's single cell - a cursor, not yet a mark. */
  caretOnly?: boolean;
}

export interface Run {
  text: string;
  marked: boolean;
  caretOnly: boolean;
}

/** Split a block's text into plain/marked runs from the union of ranges. */
export function runsFor(text: string, ranges: MarkRange[]): Run[] {
  const cuts = new Set<number>([0, text.length]);

  for (const range of ranges) {
    cuts.add(Math.max(0, range.start));
    cuts.add(Math.min(text.length, range.end));
  }
  const edges = [...cuts].toSorted((left, right) => left - right);
  const runs: Run[] = [];

  for (let index = 0; index < edges.length - 1; index++) {
    const start = edges[index]!;
    const end = edges[index + 1]!;

    if (end <= start) continue;
    const covering = ranges.filter((range) => range.start <= start && end <= range.end);
    // the caret cell shows through a mark, so the head of a selection is visible
    runs.push({
      text: text.slice(start, end),
      marked: covering.some((range) => range.caretOnly !== true),
      caretOnly: covering.some((range) => range.caretOnly === true),
    });
  }

  return runs.length > 0 ? runs : [{ text, marked: false, caretOnly: false }];
}

/** A visual line of a block: the char range of the block's text it shows. */
export interface VisualLine {
  start: number;
  end: number;
}

/**
 * Greedy word wrap into visual-line char ranges, so a comment card can slot
 * in directly below the line its mark ends on (mid-paragraph when needed).
 */
export function wrapLines(text: string, width: number): VisualLine[] {
  const lines: VisualLine[] = [];
  let segmentStart = 0;

  // hard breaks first: every visual line must be exactly one terminal row,
  // or hit-testing and the mark geometry drift from what is painted
  for (const segment of text.split("\n")) {
    const segmentEnd = segmentStart + segment.length;

    if (width <= 0 || segment.length <= width) {
      lines.push({ start: segmentStart, end: segmentEnd });
    } else {
      // greedy word wrap inside the segment; the first line keeps its
      // leading indentation, continuation lines start at a word
      let lineStart = segmentStart;
      let lineEnd = segmentStart;

      for (const word of wordRanges(segment)) {
        const wordStart = segmentStart + word.start;
        const wordEnd = segmentStart + word.end;

        if (wordEnd - lineStart > width && lineEnd > lineStart) {
          lines.push({ start: lineStart, end: lineEnd });
          lineStart = wordStart;
        }
        // a token wider than the line (a long identifier, a URL) breaks at the cell edge, so
        // every visual line stays one terminal row and nothing is clipped away
        while (wordEnd - lineStart > width) {
          lines.push({ start: lineStart, end: lineStart + width });
          lineStart += width;
        }
        lineEnd = wordEnd;
      }
      lines.push({ start: lineStart, end: Math.max(lineEnd, lineStart) });
    }
    segmentStart = segmentEnd + 1;
  }

  return lines;
}

/** The block's mark ranges clipped to one visual line, in that line's coordinates. */
export function lineMarkRanges(ranges: MarkRange[], line: VisualLine): MarkRange[] {
  return ranges
    .map((range) => ({
      start: Math.max(range.start, line.start) - line.start,
      end: Math.min(range.end, line.end) - line.start,
      caretOnly: range.caretOnly,
    }))
    .filter((range) => range.end > range.start);
}

/** A printable character: single-width input that should reach a composer. */
export function printableSequence(key: KeyEvent): string | null {
  const printable =
    key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta && key.sequence >= " ";

  return printable ? key.sequence : null;
}
