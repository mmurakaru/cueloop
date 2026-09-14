/**
 * Diff artifact projection: flatten @pierre/diffs' parsed
 * patch model into render rows. Line-anchored annotations use the same
 * quote-primary anchors as plans: quote = the line content, prefix/suffix =
 * the neighbor lines - so the whole anchor/feedback pipeline is shared.
 */

import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import {
  annotationTarget,
  isAddressed,
  resolveAnchor,
  type Annotation,
  type Block,
  type Thread,
} from "@cueloop/schema";
import { spanRangeInBlock, type TextSpan } from "./thread-selection";
import type { Mark } from "./view-plan";
import { discussionsFrom } from "./discussions";

// the diff sheet reads marks over rows as a diff concept; re-export so it need not reach into view-plan
export type { Mark } from "./view-plan";

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

/**
 * A whole file rendered as context rows, so the diff sheet can show and annotate a plain file the
 * same way it does a diff: every line is unchanged, numbered on both sides (the file view collapses
 * that to one number). A trailing newline does not add an empty final row.
 */
export function fileContentsRows(path: string, contents: string): DiffRow[] {
  const lines = contents.replace(/\n$/, "").split("\n");

  return lines.map((text, index) => ({
    kind: "ctx",
    text,
    file: path,
    oldLine: index + 1,
    newLine: index + 1,
  }));
}

/** The contiguous row range a file occupies in the aggregate diff, or null when it is not shown. */
export function fileRowRange(rows: DiffRow[], path: string): { start: number; end: number } | null {
  const start = rows.findIndex((row) => row.file === path);

  if (start === -1) return null;
  let end = start;

  while (end < rows.length && rows[end]!.file === path) end++;

  return { start, end };
}

/**
 * Marks for file-target notes on the aggregate working-tree diff. Each note resolves against only
 * its own file's rows, then the row index and span shift back to aggregate coordinates - so a quote
 * never attaches to the same text in another file or on the opposite diff side.
 */
export function fileTargetMarks(
  annotations: Annotation[],
  rows: DiffRow[],
  focusedId?: string,
): Map<number, Mark[]> {
  const byFile = new Map<string, Annotation[]>();

  for (const annotation of annotations) {
    const target = annotationTarget(annotation);

    if (target.kind !== "file") continue;
    const forPath = byFile.get(target.path) ?? [];

    forPath.push(annotation);
    byFile.set(target.path, forPath);
  }
  const result = new Map<number, Mark[]>();

  for (const [path, fileAnnotations] of byFile) {
    const range = fileRowRange(rows, path);

    if (!range) continue;
    const base = range.start;
    const fileMarks = marksByRows(fileAnnotations, rows.slice(range.start, range.end), focusedId);

    for (const [relativeRow, marks] of fileMarks) {
      result.set(
        relativeRow + base,
        marks.map((mark) =>
          mark.span
            ? {
                ...mark,
                span: {
                  start: { ...mark.span.start, blockIndex: mark.span.start.blockIndex + base },
                  end: { ...mark.span.end, blockIndex: mark.span.end.blockIndex + base },
                },
              }
            : mark,
        ),
      );
    }
  }

  return result;
}

/** A plain diff review's notes anchor to the artifact itself; a working-tree diff's notes target files. */
export function annotatesArtifact(session: Thread | null): boolean {
  return session?.artifact.type === "diff" && session.artifact.meta.workbench !== true;
}

/**
 * Render the diff from the pinned artifact rather than the live working tree: a plain diff review (the
 * artifact is the diff), or a shared/served snapshot of a workbench thread (the remote has no tree).
 */
export function readsFrozenDiff(session: Thread | null): boolean {
  return (
    session?.artifact.type === "diff" &&
    (session.artifact.meta.workbench !== true || session.artifact.meta.snapshot === true)
  );
}

/**
 * The marks a Changes surface paints. A plain diff review is the artifact itself, so only its
 * artifact-anchored notes belong; a workbench thread (live or a frozen snapshot) and every other thread
 * show a working-tree diff, whose notes carry a file target and resolve per file - so a refresh never
 * rebinds one across files, and a snapshot still surfaces the feedback already on the thread.
 */
export function changesMarks(
  session: Thread,
  rows: DiffRow[],
  focusedId?: string,
): Map<number, Mark[]> {
  if (annotatesArtifact(session)) {
    const artifactNotes = session.annotations.filter(
      (annotation) => annotationTarget(annotation).kind === "artifact",
    );

    return marksByRows(artifactNotes, rows, focusedId);
  }

  return fileTargetMarks(session.annotations, rows, focusedId);
}

/**
 * Comments per file path across the diff: each discussion counts its comments (root plus
 * replies) toward the file its span ends in. Feeds the changed-files tree and tab badges, so a
 * file whose tab is closed still shows it carries feedback.
 */
export function commentCountsByFile(session: Thread, rows: DiffRow[]): Map<string, number> {
  const discussions = discussionsFrom(session, marksByRows(session.annotations, rows));
  const counts = new Map<string, number>();

  for (const discussion of discussions) {
    const file = rows[discussion.blockIndex]?.file;

    if (file === undefined) continue;
    counts.set(file, (counts.get(file) ?? 0) + discussion.annotations.length);
  }

  return counts;
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
