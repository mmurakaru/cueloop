/**
 * The curated patch of a diff review: the submitted changes minus the hunks and
 * change blocks the reviewer rejected. The daemon computes it from the
 * session's reject decisions so the working copy every client sees is one and
 * the same; the client only maps rows to decisions.
 */

import { diffAcceptRejectHunk, parseDiffFromFile, type FileDiffMetadata } from "@pierre/diffs";
import {
  unifiedDiffText,
  type DiffFileContents,
  type DiffFileStatus,
  type HunkRejection,
} from "@cueloop/schema";

/**
 * Context lines around each change. Matching git's default (3) makes the model
 * split hunks like the rendered working-tree patch does; a row is mapped by
 * absolute line number, never by counting hunks, so a whole-hunk reject can
 * only ever span the model hunk it lands in.
 */
export const DIFF_CONTEXT = 3;

/** Parse one file's full contents into a non-partial diff model. */
export function parseFileDiff(file: DiffFileContents): FileDiffMetadata {
  return parseDiffFromFile(
    { name: file.path, contents: file.oldContents },
    { name: file.path, contents: file.newContents },
    { context: DIFF_CONTEXT },
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

  return withFileStateHeaders(patch, file.path, file.status, curatedNew);
}

/**
 * Point the diff headers at /dev/null for a created or fully-deleted file so the
 * curated patch applies. git's status - not empty contents - decides existence,
 * so editing an existing empty file stays a modify; a deletion whose removals
 * were partly restored also falls back to a modify.
 */
function withFileStateHeaders(
  patch: string,
  path: string,
  status: DiffFileStatus,
  curatedNew: string,
): string {
  if (status === "added") return patch.replace(`--- a/${path}`, "--- /dev/null");
  if (status === "deleted" && curatedNew === "") {
    return patch.replace(`+++ b/${path}`, "+++ /dev/null");
  }

  return patch;
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
