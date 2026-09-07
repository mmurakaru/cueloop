/**
 * Diff artifact projection: flatten @pierre/diffs' parsed
 * patch model into render rows. Line-anchored annotations use the same
 * quote-primary anchors as plans: quote = the line content, prefix/suffix =
 * the neighbor lines - so the whole anchor/feedback pipeline is shared.
 */

import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { isAddressed, resolveAnchor, type Annotation, type Block } from "@cueloop/schema";
import { spanRangeInBlock, type TextSpan } from "./thread-selection";
import type { Mark } from "./view-plan";

export type DiffRowKind = "file" | "hunk" | "ctx" | "add" | "del";

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
  file: string;
  oldLine?: number;
  newLine?: number;
}

export function diffRows(patchText: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const patches = parsePatchFiles(patchText);

  for (const patch of patches) {
    for (const file of patch.files) {
      rows.push({ kind: "file", text: fileLabel(file), file: file.name });
      for (const hunk of file.hunks) {
        rows.push({ kind: "hunk", text: hunk.hunkSpecs ?? "@@", file: file.name });
        let oldLine = hunk.deletionStart;
        let newLine = hunk.additionStart;

        for (const segment of hunk.hunkContent) {
          if (segment.type === "context") {
            for (let lineOffset = 0; lineOffset < segment.lines; lineOffset++) {
              rows.push({
                kind: "ctx",
                text: file.additionLines[segment.additionLineIndex + lineOffset] ?? "",
                file: file.name,
                oldLine: oldLine++,
                newLine: newLine++,
              });
            }
          } else {
            for (let lineOffset = 0; lineOffset < segment.deletions; lineOffset++) {
              rows.push({
                kind: "del",
                text: file.deletionLines[segment.deletionLineIndex + lineOffset] ?? "",
                file: file.name,
                oldLine: oldLine++,
              });
            }
            for (let lineOffset = 0; lineOffset < segment.additions; lineOffset++) {
              rows.push({
                kind: "add",
                text: file.additionLines[segment.additionLineIndex + lineOffset] ?? "",
                file: file.name,
                newLine: newLine++,
              });
            }
          }
        }
      }
    }
  }

  return rows;
}

/** Added and removed line counts per file path, for the file band's badge; base rows only. */
export function fileChangeCounts(
  rows: DiffRow[],
): Map<string, { additions: number; deletions: number }> {
  const counts = new Map<string, { additions: number; deletions: number }>();

  for (const row of rows) {
    if (row.kind !== "add" && row.kind !== "del") continue;
    const entry = counts.get(row.file) ?? { additions: 0, deletions: 0 };

    if (row.kind === "add") entry.additions += 1;
    else entry.deletions += 1;
    counts.set(row.file, entry);
  }

  return counts;
}

function fileLabel(file: FileDiffMetadata): string {
  return file.prevName && file.prevName !== file.name
    ? `${file.prevName} → ${file.name}`
    : file.name;
}

/** Row text carries the patch's trailing newline; anchors and rendering strip it. */
export function diffRowText(row: DiffRow): string {
  return row.text.replace(/\n$/, "");
}

/**
 * The diff rows as anchor blocks, one per row in row order, so a comment span anchors
 * with the same quote/context/position selectors a plan block does. Header rows are
 * blocks too (indices stay 1:1 with the rows) but hold no comment.
 */
export function diffRowBlocks(rows: DiffRow[]): Block[] {
  return rows.map((row, index) => ({
    kind: "code",
    text: row.kind === "file" || row.kind === "hunk" ? "" : diffRowText(row),
    lineStart: index,
    lineEnd: index,
  }));
}

/**
 * Resolve annotations against the diff rows and group marks per row index, with
 * character ranges and the whole span, so the diff sheet paints and threads them
 * exactly as the plan view does its blocks.
 */
export function marksByRows(
  annotations: Annotation[],
  rows: DiffRow[],
  focusedId?: string,
): Map<number, Mark[]> {
  const blocks = diffRowBlocks(rows);
  const marksByIndex = new Map<number, Mark[]>();

  for (const annotation of annotations) {
    // an addressed annotation keeps its record but paints no highlight
    if (isAddressed(annotation)) continue;
    const resolved = resolveAnchor(annotation.anchor, blocks);

    if (!resolved) continue;
    const span: TextSpan = {
      start: { blockIndex: resolved.blockIndex, char: resolved.start },
      end: { blockIndex: resolved.endBlockIndex, char: resolved.end },
    };

    // a span paints on every row it covers; the mark carries the whole span
    for (let rowIndex = resolved.blockIndex; rowIndex <= resolved.endBlockIndex; rowIndex++) {
      const range = spanRangeInBlock(span, rowIndex, blocks[rowIndex]!.text.length);

      if (!range) continue;
      const marks = marksByIndex.get(rowIndex) ?? [];

      marks.push({
        start: range.start,
        end: range.end,
        role: annotation.id === focusedId ? "mark-focus" : "mark-comment",
        annotationId: annotation.id,
        span,
      });
      marksByIndex.set(rowIndex, marks);
    }
  }

  return marksByIndex;
}

/** Quote-primary anchor for a diff row: neighbors as context selectors. */
export function diffRowAnchor(rows: DiffRow[], rowIndex: number) {
  const row = rows[rowIndex]!;
  const prev = rows[rowIndex - 1];
  const next = rows[rowIndex + 1];

  return {
    quote: row.text,
    prefix:
      prev && (prev.kind === "ctx" || prev.kind === "add" || prev.kind === "del")
        ? prev.text.slice(-24)
        : "",
    suffix:
      next && (next.kind === "ctx" || next.kind === "add" || next.kind === "del")
        ? next.text.slice(0, 24)
        : "",
  };
}

/** Location label for the rail and feedback: file:newLine (or old for del). */
export function diffRowLocation(row: DiffRow): string {
  const line = row.newLine ?? row.oldLine;

  return line !== undefined ? `${row.file}:${line}` : row.file;
}
