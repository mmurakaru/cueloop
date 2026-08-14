/**
 * Diff artifact projection: flatten @pierre/diffs' parsed
 * patch model into render rows. Line-anchored annotations use the same
 * quote-primary anchors as plans: quote = the line content, prefix/suffix =
 * the neighbor lines - so the whole anchor/feedback pipeline is shared.
 */

import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";

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

function fileLabel(file: FileDiffMetadata): string {
  return file.prevName && file.prevName !== file.name ? `${file.prevName} → ${file.name}` : file.name;
}

/** Quote-primary anchor for a diff row: neighbors as context selectors. */
export function diffRowAnchor(rows: DiffRow[], rowIndex: number): { quote: string; prefix: string; suffix: string } {
  const row = rows[rowIndex]!;
  const prev = rows[rowIndex - 1];
  const next = rows[rowIndex + 1];
  return {
    quote: row.text,
    prefix: prev && (prev.kind === "ctx" || prev.kind === "add" || prev.kind === "del") ? prev.text.slice(-24) : "",
    suffix: next && (next.kind === "ctx" || next.kind === "add" || next.kind === "del") ? next.text.slice(0, 24) : "",
  };
}

/** Location label for the rail and feedback: file:newLine (or old for del). */
export function diffRowLocation(row: DiffRow): string {
  const line = row.newLine ?? row.oldLine;
  return line !== undefined ? `${row.file}:${line}` : row.file;
}
