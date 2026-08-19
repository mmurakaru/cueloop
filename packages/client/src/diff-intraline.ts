/**
 * Intra-line word diff: the char-precise "what changed within this line" engine
 * shared by the plan tracked-changes view and the diff review sheet. Backed by
 * jsdiff diffWordsWithSpace, so it is punctuation-aware and whitespace-lossless:
 * the run values always concatenate back to the exact inputs, which keeps quote
 * anchors intact. Supersedes the coarse LCS wordDiff.
 */

import { diffWordsWithSpace } from "diff";
import { lcsDiff } from "@cueloop/schema";
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
 * run of deletions immediately followed by additions - lines are aligned to their
 * real counterpart (see alignedPairs) and each matched pair is word-diffed so the
 * removed/added words are marked changed. Rows with no counterpart (pure add, pure
 * delete, or an unmatched line in a shifted block) are omitted, so the caller
 * renders those as a single run. Each row's runs concatenate back to that row's text.
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
    const deletionTexts = rows
      .slice(deletionStart, additionStart)
      .map((row) => stripTrailingNewline(row.text));
    const additionTexts = rows
      .slice(additionStart, index)
      .map((row) => stripTrailingNewline(row.text));
    for (const [deletionOffset, additionOffset] of alignedPairs(deletionTexts, additionTexts)) {
      const changes = wordLevelChanges(
        deletionTexts[deletionOffset]!,
        additionTexts[additionOffset]!,
      );
      runsByRow.set(deletionStart + deletionOffset, sideRuns(changes, "removed"));
      runsByRow.set(additionStart + additionOffset, sideRuns(changes, "added"));
    }
  }
  return runsByRow;
}

/** Lines this similar (word-set overlap) are treated as the same line edited. */
const SIMILAR_MIN_WORD_OVERLAP = 0.3;

/** Whether two lines are the same line edited, by case-insensitive word-set
 *  overlap - the matching gate, distinct from the case-sensitive word diff. */
function linesSimilar(oldText: string, newText: string): boolean {
  const words = (text: string) => new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
  const oldWords = words(oldText);
  const newWords = words(newText);
  if (oldWords.size === 0 && newWords.size === 0) return true;
  let intersection = 0;
  for (const word of oldWords) if (newWords.has(word)) intersection++;
  const union = oldWords.size + newWords.size - intersection;
  return union === 0 ? true : intersection / union >= SIMILAR_MIN_WORD_OVERLAP;
}

/**
 * Pair each modified line with the addition it became. A lone deletion opposite
 * a lone addition is one edit (always paired). Otherwise align the lines by
 * similarity, order-preserving (LCS over `linesSimilar`), so an inserted, removed,
 * or shifted line finds its real counterpart instead of mispairing by position -
 * unmatched lines get no pair and render whole-line. Returns [deletionOffset,
 * additionOffset] pairs into the block.
 */
function alignedPairs(deletionTexts: string[], additionTexts: string[]): Array<[number, number]> {
  if (deletionTexts.length === 1 && additionTexts.length === 1) return [[0, 0]];
  const pairs: Array<[number, number]> = [];
  let deletionOffset = 0;
  let additionOffset = 0;
  for (const op of lcsDiff(deletionTexts, additionTexts, linesSimilar)) {
    if (op.kind === "ctx") {
      pairs.push([deletionOffset, additionOffset]);
      deletionOffset++;
      additionOffset++;
    } else if (op.kind === "del") {
      deletionOffset++;
    } else {
      additionOffset++;
    }
  }
  return pairs;
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
