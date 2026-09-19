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

/** A change block: a run of deletion rows immediately followed by addition rows. */
interface IntralineBlock {
  deletionStart: number;
  additionStart: number;
  end: number;
}

/** The change blocks in row order, found in one cheap pass (no word diff yet). */
function intralineBlocks(rows: DiffRow[]): IntralineBlock[] {
  const blocks: IntralineBlock[] = [];
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
    blocks.push({ deletionStart, additionStart, end: index });
  }

  return blocks;
}

/** Word-diff one change block into [rowIndex, runs] pairs; unmatched rows get no entry. */
function blockRunEntries(rows: DiffRow[], block: IntralineBlock): Array<[number, IntralineRun[]]> {
  const deletionTexts = rows
    .slice(block.deletionStart, block.additionStart)
    .map((row) => stripTrailingNewline(row.text));
  const additionTexts = rows
    .slice(block.additionStart, block.end)
    .map((row) => stripTrailingNewline(row.text));
  const entries: Array<[number, IntralineRun[]]> = [];

  for (const [deletionOffset, additionOffset] of alignedPairs(deletionTexts, additionTexts)) {
    const changes = wordLevelChanges(
      deletionTexts[deletionOffset]!,
      additionTexts[additionOffset]!,
    );

    entries.push([block.deletionStart + deletionOffset, sideRuns(changes, "removed")]);
    entries.push([block.additionStart + additionOffset, sideRuns(changes, "added")]);
  }

  return entries;
}

/** The change block whose rows cover `rowIndex`, by binary search over the ordered blocks. */
function blockContaining(blocks: IntralineBlock[], rowIndex: number): number | undefined {
  let low = 0;
  let high = blocks.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const block = blocks[mid]!;

    if (rowIndex < block.deletionStart) high = mid - 1;
    else if (rowIndex >= block.end) low = mid + 1;
    else return mid;
  }

  return undefined;
}

/** A row's intra-line runs, resolved on demand. */
export interface IntralineResolver {
  runsForRow(rowIndex: number): IntralineRun[] | undefined;
}

/**
 * Char-precise intra-line runs for modified diff rows, computed lazily. The change blocks are found
 * up front in one cheap pass; a block is word-diffed only when a row inside it is first asked for,
 * so a virtualized diff pays for the rows on screen, not for the whole file. Within a change block -
 * deletions immediately followed by additions - lines align to their real counterpart (alignedPairs)
 * and each matched pair is word-diffed; unmatched rows get no runs, so the caller renders those whole.
 */
export function createIntralineResolver(rows: DiffRow[]): IntralineResolver {
  const blocks = intralineBlocks(rows);
  const computed = new Set<number>();
  const runsByRow = new Map<number, IntralineRun[]>();

  return {
    runsForRow(rowIndex) {
      const blockIndex = blockContaining(blocks, rowIndex);

      if (blockIndex === undefined) return undefined;
      if (!computed.has(blockIndex)) {
        computed.add(blockIndex);
        for (const [row, runs] of blockRunEntries(rows, blocks[blockIndex]!))
          runsByRow.set(row, runs);
      }

      return runsByRow.get(rowIndex);
    },
  };
}

/** Every modified row's intra-line runs, eagerly. Prefer createIntralineResolver on a hot path. */
export function intralineRunsByRow(rows: DiffRow[]): Map<number, IntralineRun[]> {
  const runsByRow = new Map<number, IntralineRun[]>();

  for (const block of intralineBlocks(rows)) {
    for (const [row, runs] of blockRunEntries(rows, block)) runsByRow.set(row, runs);
  }

  return runsByRow;
}

/** Lines this similar (word-set overlap) are treated as the same line edited. */
const SIMILAR_MIN_WORD_OVERLAP = 0.3;

/** Lower-cased word set of a line for the similarity gate, cached per distinct line within a block so
 *  the LCS grid tokenizes each line once instead of once per comparison. */
function lineWordSetCache(): (text: string) => ReadonlySet<string> {
  const cache = new Map<string, ReadonlySet<string>>();

  return (text) => {
    const cached = cache.get(text);
    if (cached !== undefined) return cached;
    const words = new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
    cache.set(text, words);

    return words;
  };
}

/** Whether two lines are the same line edited, by case-insensitive word-set
 *  overlap - the matching gate, distinct from the case-sensitive word diff. */
function linesSimilar(
  wordsOf: (text: string) => ReadonlySet<string>,
  oldText: string,
  newText: string,
): boolean {
  const oldWords = wordsOf(oldText);
  const newWords = wordsOf(newText);

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
  const wordsOf = lineWordSetCache();

  for (const op of lcsDiff(deletionTexts, additionTexts, (deletionText, additionText) =>
    linesSimilar(wordsOf, deletionText, additionText),
  )) {
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
