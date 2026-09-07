/**
 * Side-by-side diff projection: fold the unified DiffRow list into paired rows,
 * old on the left and new on the right. A context line sits on both sides; a
 * change block zips its deletions against its additions to the taller side, with
 * a blank filler where one side runs out. Each side keeps its originating unified
 * row, so the cursor, anchors, and curation keep working through the base rows.
 */

import type { DiffRow } from "./view-diff";

/** One code line on one side of the split, carrying its originating unified row. */
export interface SplitLine {
  /** The unified diff row this side renders; the anchor and curation target. */
  row: DiffRow;
  /** Index of the originating row in the base list; the cursor and curation index. */
  rowIndex: number;
  kind: "ctx" | "del" | "add";
  text: string;
  /** Old line number for the left column, new line number for the right column. */
  lineNumber?: number;
}

/** A rendered split row: a file band, a hunk header, or an old|new line pair. */
export interface SplitRow {
  kind: "file" | "hunk" | "pair";
  file: string;
  /** Header text for file and hunk rows. */
  text?: string;
  /** Old side: a context or deletion line, or absent (blank filler). */
  left?: SplitLine;
  /** New side: a context or addition line, or absent (blank filler). */
  right?: SplitLine;
}

/** A base row paired with its index in the base list. */
interface IndexedRow {
  row: DiffRow;
  index: number;
}

function contextLine({ row, index }: IndexedRow, side: "left" | "right"): SplitLine {
  return {
    row,
    rowIndex: index,
    kind: "ctx",
    text: row.text,
    lineNumber: side === "left" ? row.oldLine : row.newLine,
  };
}

function deletionLine({ row, index }: IndexedRow): SplitLine {
  return { row, rowIndex: index, kind: "del", text: row.text, lineNumber: row.oldLine };
}

function additionLine({ row, index }: IndexedRow): SplitLine {
  return { row, rowIndex: index, kind: "add", text: row.text, lineNumber: row.newLine };
}

/** Zip a change block's deletions against its additions, blank-filling the shorter side. */
function zipChangeBlock(
  deletions: IndexedRow[],
  additions: IndexedRow[],
  file: string,
): SplitRow[] {
  const pairs: SplitRow[] = [];
  const height = Math.max(deletions.length, additions.length);

  for (let index = 0; index < height; index++) {
    const del = deletions[index];
    const add = additions[index];

    pairs.push({
      kind: "pair",
      file,
      left: del ? deletionLine(del) : undefined,
      right: add ? additionLine(add) : undefined,
    });
  }

  return pairs;
}

/** Project unified diff rows into side-by-side split rows. */
export function splitDiffRows(rows: DiffRow[]): SplitRow[] {
  const split: SplitRow[] = [];
  let pendingDeletions: IndexedRow[] = [];
  let pendingAdditions: IndexedRow[] = [];
  let blockFile = "";

  const flushChangeBlock = (): void => {
    if (pendingDeletions.length === 0 && pendingAdditions.length === 0) return;
    split.push(...zipChangeBlock(pendingDeletions, pendingAdditions, blockFile));
    pendingDeletions = [];
    pendingAdditions = [];
  };

  rows.forEach((row, index) => {
    if (row.kind === "add") {
      blockFile = row.file;
      pendingAdditions.push({ row, index });
      return;
    }
    if (row.kind === "del") {
      blockFile = row.file;
      pendingDeletions.push({ row, index });
      return;
    }
    // any non-change row closes the current change block before it renders
    flushChangeBlock();
    if (row.kind === "file") split.push({ kind: "file", file: row.file, text: row.text });
    else if (row.kind === "hunk") split.push({ kind: "hunk", file: row.file, text: row.text });
    else
      split.push({
        kind: "pair",
        file: row.file,
        left: contextLine({ row, index }, "left"),
        right: contextLine({ row, index }, "right"),
      });
  });
  flushChangeBlock();

  return split;
}

/**
 * Visual y of each base row index in the split layout, so the cursor scrolls into
 * view. A file band spans three rows (rule, name, rule), a hunk one, a pair one; a
 * pair's two sides share the row, so both base indices map to the same y.
 */
export function splitRowOffsets(splitRows: SplitRow[]): Map<number, number> {
  const offsets = new Map<number, number>();
  let contentY = 0;

  for (const row of splitRows) {
    if (row.kind === "file") {
      contentY += 3;
    } else if (row.kind === "hunk") {
      contentY += 1;
    } else {
      if (row.left) offsets.set(row.left.rowIndex, contentY);
      if (row.right) offsets.set(row.right.rowIndex, contentY);
      contentY += 1;
    }
  }

  return offsets;
}
