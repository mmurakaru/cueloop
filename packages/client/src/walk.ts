/**
 * Guided-walk projections: pure helpers over the diff row model - no
 * IO, no React. The walk steps through the changed files in patch order;
 * which files were seen lives on the session record (viewedPaths), which
 * file is on screen is view state in the session controller.
 */

import type { Annotation } from "@cueloop/schema";
import type { DiffRow } from "./view-diff";

/** One wizard step: a changed file with its stats and a short diff preview. */
export interface WalkFile {
  path: string;
  added: number;
  removed: number;
  /** The first changed lines, signed (+/-), for the card's diff preview. */
  preview: { sign: "+" | "-"; text: string }[];
}

/** Preview lines per card: enough to recognize the change, never a full diff. */
export const WALK_PREVIEW_ROWS = 5;

/** Collapse the diff rows into one walk step per changed file, in patch order. */
export function walkFiles(rows: DiffRow[]): WalkFile[] {
  const files: WalkFile[] = [];
  const byPath = new Map<string, WalkFile>();
  for (const row of rows) {
    let file = byPath.get(row.file);
    if (!file) {
      file = { path: row.file, added: 0, removed: 0, preview: [] };
      byPath.set(row.file, file);
      files.push(file);
    }
    if (row.kind !== "add" && row.kind !== "del") continue;
    if (row.kind === "add") file.added += 1;
    else file.removed += 1;
    if (file.preview.length < WALK_PREVIEW_ROWS) {
      file.preview.push({ sign: row.kind === "add" ? "+" : "-", text: row.text.replace(/\n$/, "") });
    }
  }
  return files;
}

/**
 * Where the walk resumes: the first file not yet marked viewed. All files
 * viewed = the end card (index === files.length), so a finished walk reopens
 * on its summary instead of restarting.
 */
export function firstUnviewedIndex(files: WalkFile[], viewedPaths: ReadonlySet<string>): number {
  const index = files.findIndex((file) => !viewedPaths.has(file.path));
  return index === -1 ? files.length : index;
}

/** Viewed count against the CURRENT file set - stale paths never inflate it. */
export function viewedCount(files: WalkFile[], viewedPaths: ReadonlySet<string>): number {
  return files.filter((file) => viewedPaths.has(file.path)).length;
}

/**
 * The agent's note for a file: an annotation with kind "note" whose anchor
 * quote is the file path (the note contract in the shared review core).
 */
export function noteForFile(annotations: Annotation[], path: string): string | undefined {
  return annotations.find((annotation) => annotation.kind === "note" && annotation.anchor.quote === path)?.body;
}
