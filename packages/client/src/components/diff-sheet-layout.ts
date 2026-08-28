/**
 * Pure layout logic for the diff review sheet, split out so it can be tested
 * without rendering: grouping rows into chunks around headers and annotations,
 * resolving each row's colored spans (syntax under the intra-line change color),
 * mapping annotations to rows, and the content-y offset of each row for scroll.
 * DiffSheet.tsx is the thin renderer over these.
 */

import type { Annotation } from "@cueloop/schema";
import type { DiffRow } from "../view-diff";
import type { Theme } from "../theme";
import type { IntralineRun } from "../diff-intraline";
import type { SyntaxSpan } from "../diff-syntax";
import { colorForSyntaxGroup } from "./syntax-highlight";

/** A header row rendered on its own line, or a contiguous run of code rows. */
export type DiffSegment =
  | { kind: "header"; rowIndex: number; row: DiffRow }
  | { kind: "chunk"; firstRowIndex: number; rows: DiffRow[]; annotation: Annotation | null };

/** One rendered span of a row: its text and its resolved foreground color. */
export interface ColoredSpan {
  text: string;
  foreground: string;
}

/** Row text carries the patch's trailing newline; rendering strips it. */
export function rowLine(row: DiffRow): string {
  return row.text.replace(/\n$/, "");
}

/** The annotation anchored to each row, matched by its verbatim quote. */
export function annotatedRowsByIndex(
  rows: DiffRow[],
  annotations: Annotation[],
): Map<number, Annotation> {
  const byRow = new Map<number, Annotation>();

  for (const annotation of annotations) {
    const rowIndex = rows.findIndex(
      (row) =>
        row.text === annotation.anchor.quote &&
        (row.kind === "ctx" || row.kind === "add" || row.kind === "del"),
    );

    if (rowIndex !== -1) byRow.set(rowIndex, annotation);
  }

  return byRow;
}

/** Group rows into header segments and code chunks; a chunk closes after an
 *  annotated or composed row so a card can render directly below that line. */
export function segmentRows(
  rows: DiffRow[],
  annotatedByRow: Map<number, Annotation>,
  composeRowIndex?: number,
): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let chunk: DiffRow[] = [];
  let chunkStart = 0;

  const closeChunk = (annotation: Annotation | null): void => {
    if (chunk.length) {
      segments.push({ kind: "chunk", firstRowIndex: chunkStart, rows: chunk, annotation });
    }
    chunk = [];
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;

    if (row.kind === "file" || row.kind === "hunk") {
      closeChunk(null);
      segments.push({ kind: "header", rowIndex, row });
      chunkStart = rowIndex + 1;
      continue;
    }
    if (!chunk.length) chunkStart = rowIndex;
    chunk.push(row);

    const annotation = annotatedByRow.get(rowIndex);

    if (annotation) {
      closeChunk(annotation);
      chunkStart = rowIndex + 1;
    } else if (rowIndex === composeRowIndex) {
      closeChunk(null);
      chunkStart = rowIndex + 1;
    }
  }
  closeChunk(null);

  return segments;
}

/** The content-y offset of each row index, so the cursor can be scrolled into
 *  view; a chunk's annotation adds one row for its card. */
export function rowContentOffsets(segments: DiffSegment[]): number[] {
  const offsets: number[] = [];
  let contentY = 0;

  for (const segment of segments) {
    if (segment.kind === "header") {
      offsets[segment.rowIndex] = contentY;
      contentY += 1;
    } else {
      segment.rows.forEach((_, lineIndex) => {
        offsets[segment.firstRowIndex + lineIndex] = contentY + lineIndex;
      });
      contentY += segment.rows.length + (segment.annotation ? 1 : 0);
    }
  }

  return offsets;
}

/**
 * Colored spans for one row, resolved per character: an intra-line changed word
 * keeps the diff color, otherwise the syntax color applies, falling back to the
 * dim token on the unchanged part of a modified line or the row's base color.
 * Adjacent same-color characters coalesce so a row stays a few spans.
 */
export function coloredRowSpans(
  text: string,
  intralineRuns: IntralineRun[] | undefined,
  syntaxSpans: SyntaxSpan[] | undefined,
  baseColor: string,
  tokens: Theme,
): ColoredSpan[] {
  const changed = changedColumns(text.length, intralineRuns);
  const syntaxColorByColumn = syntaxColorColumns(text.length, syntaxSpans, tokens);
  const isModifiedLine = intralineRuns !== undefined;

  const spans: ColoredSpan[] = [];

  for (let column = 0; column < text.length; column++) {
    const color = changed[column]
      ? baseColor
      : (syntaxColorByColumn[column] ?? (isModifiedLine ? tokens.textDim : baseColor));
    const previous = spans[spans.length - 1];

    if (previous && previous.foreground === color) previous.text += text[column];
    else spans.push({ text: text[column]!, foreground: color });
  }

  return spans;
}

/** Which columns are the intra-line change on a modified line. */
function changedColumns(length: number, intralineRuns: IntralineRun[] | undefined): boolean[] {
  const changed = Array.from({ length }, () => false);

  if (!intralineRuns) return changed;
  let offset = 0;

  for (const run of intralineRuns) {
    if (run.changed)
      for (let index = 0; index < run.text.length; index++) changed[offset + index] = true;
    offset += run.text.length;
  }

  return changed;
}

/** The syntax color per column, or undefined where a column has no token. */
function syntaxColorColumns(
  length: number,
  syntaxSpans: SyntaxSpan[] | undefined,
  tokens: Theme,
): Array<string | undefined> {
  const colors: Array<string | undefined> = Array.from({ length }, () => undefined);

  for (const span of syntaxSpans ?? []) {
    const color = colorForSyntaxGroup(span.group, tokens);

    if (!color) continue;
    for (let column = span.start; column < span.end && column < length; column++) {
      colors[column] = color;
    }
  }

  return colors;
}
