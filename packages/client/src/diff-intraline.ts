/**
 * Intra-line word diff: the char-precise "what changed within this line" engine
 * shared by the plan tracked-changes view and the diff review sheet. Backed by
 * jsdiff diffWordsWithSpace, so it is punctuation-aware and whitespace-lossless:
 * the run values always concatenate back to the exact inputs, which keeps quote
 * anchors intact. Supersedes the coarse LCS wordDiff.
 */

import { diffWordsWithSpace } from "diff";
import type { DiffRow } from "./view-diff";

export type WordChangeKind = "common" | "added" | "removed";

/** One word-level change between two strings; text is verbatim (lossless). */
export interface WordChange {
  text: string;
  kind: WordChangeKind;
}

/** Word-level changes between two strings, whitespace-lossless and ordered. */
export function wordLevelChanges(oldText: string, newText: string): WordChange[] {
  return diffWordsWithSpace(oldText, newText).map((change) => ({
    text: change.value,
    kind: change.added ? "added" : change.removed ? "removed" : "common",
  }));
}

/** One rendered segment of a diff row: changed marks the intra-line change. */
export interface IntralineRun {
  text: string;
  changed: boolean;
}

function stripTrailingNewline(text: string): string {
  return text.replace(/\n$/, "");
}

/**
 * Char-precise intra-line runs for modified diff rows. Within a change block - a
 * run of deletions immediately followed by additions - each deletion pairs with
 * the addition at the same offset; the pair is word-diffed and the removed/added
 * words are marked changed. Rows with no counterpart (pure add or pure delete)
 * are omitted, so the caller renders those as a single run. Each row's runs
 * concatenate back to that row's text.
 */
export function intralineRunsByRow(rows: DiffRow[]): Map<number, IntralineRun[]> {
  const runsByRow = new Map<number, IntralineRun[]>();
  let index = 0;
  while (index < rows.length) {
    if (rows[index]!.kind !== "del") {
      index++;
      continue;
    }
    const deletionStart = index;
    while (index < rows.length && rows[index]!.kind === "del") index++;
    const additionStart = index;
    while (index < rows.length && rows[index]!.kind === "add") index++;
    const pairCount = Math.min(additionStart - deletionStart, index - additionStart);
    for (let offset = 0; offset < pairCount; offset++) {
      const deletionRow = rows[deletionStart + offset]!;
      const additionRow = rows[additionStart + offset]!;
      const changes = wordLevelChanges(stripTrailingNewline(deletionRow.text), stripTrailingNewline(additionRow.text));
      runsByRow.set(deletionStart + offset, sideRuns(changes, "removed"));
      runsByRow.set(additionStart + offset, sideRuns(changes, "added"));
    }
  }
  return runsByRow;
}

/** Runs for one side of a word diff: common plus this side's changes, adjacent
 *  runs of equal changed-ness coalesced so highlighting stays as few spans. */
function sideRuns(changes: WordChange[], side: "added" | "removed"): IntralineRun[] {
  const runs: IntralineRun[] = [];
  for (const change of changes) {
    if (change.kind !== "common" && change.kind !== side) continue;
    const changed = change.kind === side;
    const last = runs[runs.length - 1];
    if (last && last.changed === changed) last.text += change.text;
    else runs.push({ text: change.text, changed });
  }
  return runs;
}
