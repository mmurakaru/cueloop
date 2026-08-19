/**
 * Diff hunk curation: turn a set of reject decisions over a working-tree diff
 * into the curated unified-diff patch of the accepted changes only. Each file
 * is re-parsed from its FULL old/new contents (isPartial: false), so
 * `diffAcceptRejectHunk` can revert a whole hunk or a single change and the
 * serialized patch keeps exact line numbers and stays applyable.
 *
 * A rejection is addressed by parse-model coordinates, never by rendered-row
 * position: `hunkIndex` indexes `model.hunks`, and `changeIndex` indexes that
 * hunk's `hunkContent` (context and change blocks combined - the same space
 * `diffAcceptRejectHunk`'s config consumes). A cursor row is mapped to those
 * coordinates by its absolute file line number, so it stays correct even when
 * the stored git patch and the model split hunks differently.
 */

import { parseDiffFromFile, diffAcceptRejectHunk, type FileDiffMetadata } from "@pierre/diffs";
import { unifiedDiffText, type DiffFileContents } from "@cueloop/schema";
import type { DiffRow } from "./view-diff";

/** One reject decision; `changeIndex` absent rejects the whole hunk. */
export interface HunkRejection {
  path: string;
  hunkIndex: number;
  changeIndex?: number;
}

/** Which side of the diff a line number addresses. */
type DiffSide = "addition" | "deletion";

/** A line resolved onto its owning hunk, and its change block when it is one. */
export interface LocatedLine {
  hunkIndex: number;
  /** Present only when the line sits inside a change block (an add/del line). */
  changeIndex?: number;
}

/**
 * Context lines around each change. Matching git's default (3) makes the model
 * split hunks like the rendered working-tree patch does; git's coalescing can
 * still merge adjacent hunks differently, but the row is mapped by absolute line
 * number (not by counting hunks), so a whole-hunk reject can only ever span the
 * model hunk it lands in - never the wrong file or a crash.
 */
const DIFF_CONTEXT = 3;

/** Parse one file's full contents into a non-partial diff model. */
export function parseFileDiff(file: DiffFileContents): FileDiffMetadata {
  return parseDiffFromFile(
    { name: file.path, contents: file.oldContents },
    { name: file.path, contents: file.newContents },
    { context: DIFF_CONTEXT },
  );
}

/**
 * Resolve a 1-based file line on one side to its hunk and, when the line is
 * part of a change block, that block's `hunkContent` index.
 */
export function locateLine(
  model: FileDiffMetadata,
  side: DiffSide,
  lineNumber: number,
): LocatedLine | null {
  const index = lineNumber - 1;
  for (const [hunkIndex, hunk] of model.hunks.entries()) {
    for (const [contentIndex, content] of hunk.hunkContent.entries()) {
      const base = side === "addition" ? content.additionLineIndex : content.deletionLineIndex;
      const count =
        content.type === "context"
          ? content.lines
          : side === "addition"
            ? content.additions
            : content.deletions;
      if (count > 0 && index >= base && index < base + count) {
        return { hunkIndex, changeIndex: content.type === "change" ? contentIndex : undefined };
      }
    }
  }
  return null;
}

/** The side and line number a change row addresses; null for headers/context. */
function changeSideLine(
  row: Pick<DiffRow, "kind" | "oldLine" | "newLine">,
): { side: DiffSide; lineNumber: number } | null {
  if (row.kind === "add" && row.newLine !== undefined)
    return { side: "addition", lineNumber: row.newLine };
  if (row.kind === "del" && row.oldLine !== undefined)
    return { side: "deletion", lineNumber: row.oldLine };
  return null;
}

/**
 * The whole-hunk rejection for the row under the cursor, or null when the row
 * is not inside a hunk. Context rows resolve through their new-file line.
 */
export function hunkRejectionForRow(
  path: string,
  model: FileDiffMetadata,
  row: Pick<DiffRow, "kind" | "oldLine" | "newLine">,
): HunkRejection | null {
  const change = changeSideLine(row);
  const located = change
    ? locateLine(model, change.side, change.lineNumber)
    : row.newLine !== undefined
      ? locateLine(model, "addition", row.newLine)
      : row.oldLine !== undefined
        ? locateLine(model, "deletion", row.oldLine)
        : null;
  return located ? { path, hunkIndex: located.hunkIndex } : null;
}

/**
 * The change-level rejection for the row under the cursor, or null when the row
 * carries no change (a header or context line).
 */
export function changeRejectionForRow(
  path: string,
  model: FileDiffMetadata,
  row: Pick<DiffRow, "kind" | "oldLine" | "newLine">,
): HunkRejection | null {
  const change = changeSideLine(row);
  if (!change) return null;
  const located = locateLine(model, change.side, change.lineNumber);
  if (!located || located.changeIndex === undefined) return null;
  return { path, hunkIndex: located.hunkIndex, changeIndex: located.changeIndex };
}

/** Whether two rejections address the same target. */
export function sameRejection(left: HunkRejection, right: HunkRejection): boolean {
  return (
    left.path === right.path &&
    left.hunkIndex === right.hunkIndex &&
    left.changeIndex === right.changeIndex
  );
}

/** Whether `rejection` drops the whole hunk that `target` sits in. */
export function rejectsWholeHunk(rejection: HunkRejection, target: HunkRejection): boolean {
  return (
    rejection.path === target.path &&
    rejection.hunkIndex === target.hunkIndex &&
    rejection.changeIndex === undefined
  );
}

/** Whether a change row is dropped by the current decisions (for dimming). */
export function isRowRejected(
  path: string,
  model: FileDiffMetadata,
  row: Pick<DiffRow, "kind" | "oldLine" | "newLine">,
  rejections: HunkRejection[],
): boolean {
  const change = changeSideLine(row);
  if (!change) return false;
  const located = locateLine(model, change.side, change.lineNumber);
  if (!located || located.changeIndex === undefined) return false;
  return rejections.some(
    (rejection) =>
      rejection.path === path &&
      rejection.hunkIndex === located.hunkIndex &&
      (rejection.changeIndex === undefined || rejection.changeIndex === located.changeIndex),
  );
}

/**
 * Apply one file's rejections and return its curated patch, or null when the
 * curated content equals the old content (every change rejected - no patch).
 * Whole-hunk rejections supersede change-level ones for the same hunk. Because
 * `diffAcceptRejectHunk` returns a model with the same hunk/content shape, the
 * indices stay valid across calls; they are applied high-to-low regardless, so
 * the order is deterministic.
 */
function curateFilePatch(file: DiffFileContents, rejections: HunkRejection[]): string | null {
  let model = parseFileDiff(file);
  const wholeHunks = new Set(
    rejections
      .filter((rejection) => rejection.changeIndex === undefined)
      .map((rejection) => rejection.hunkIndex),
  );
  for (const hunkIndex of [...wholeHunks].sort((a, b) => b - a)) {
    model = diffAcceptRejectHunk(model, hunkIndex, "reject");
  }
  const changeRejections = rejections
    .filter(
      (rejection) => rejection.changeIndex !== undefined && !wholeHunks.has(rejection.hunkIndex),
    )
    .sort((a, b) => b.hunkIndex - a.hunkIndex || b.changeIndex! - a.changeIndex!);
  for (const rejection of changeRejections) {
    model = diffAcceptRejectHunk(model, rejection.hunkIndex, {
      type: "reject",
      changeIndex: rejection.changeIndex!,
    });
  }
  const curatedNew = model.additionLines.join("");
  if (curatedNew === file.oldContents) return null;
  const patch = unifiedDiffText(file.oldContents, curatedNew, file.path);
  if (patch === null) return null;
  return withFileStateHeaders(patch, file.path, file.oldContents, curatedNew);
}

/**
 * Point the diff headers at /dev/null for a created or deleted file so the
 * curated patch applies. A rename is not represented (DiffFileContents carries
 * no previous name); it degrades to a created file at the new path.
 */
function withFileStateHeaders(
  patch: string,
  path: string,
  oldContents: string,
  newContents: string,
): string {
  let headed = patch;
  if (oldContents === "") headed = headed.replace(`--- a/${path}`, "--- /dev/null");
  if (newContents === "") headed = headed.replace(`+++ b/${path}`, "+++ /dev/null");
  return headed;
}

/**
 * The curated unified-diff patch of the accepted changes across every file.
 * Files with no net change (unchanged, or with all changes rejected) drop out.
 */
export function curateDiff(files: DiffFileContents[], rejections: HunkRejection[]): string {
  const parts: string[] = [];
  for (const file of files) {
    const fileRejections = rejections.filter((rejection) => rejection.path === file.path);
    const patch = curateFilePatch(file, fileRejections);
    if (patch) parts.push(patch);
  }
  return parts.join("\n");
}
