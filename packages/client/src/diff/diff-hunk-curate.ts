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

import type { FileDiffMetadata } from "@pierre/diffs";
import type { HunkRejection } from "@cueloop/schema";
import type { DiffRow } from "./view-diff";

export { curateDiff, parseFileDiff } from "@cueloop/daemon/curate";
export type { HunkRejection } from "@cueloop/schema";

/** Which side of the diff a line number addresses. */
type DiffSide = "addition" | "deletion";

/** A line resolved onto its owning hunk, and its change block when it is one. */
export interface LocatedLine {
  hunkIndex: number;
  /** Present only when the line sits inside a change block (an add/del line). */
  changeIndex?: number;
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
