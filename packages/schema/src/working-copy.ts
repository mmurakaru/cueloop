/** Working-copy source surgery for block and character cuts plus block restoration. */

import { parseBlocks, sourceOffsetAt, type Block } from "./markdown";
import type { TextCut } from "./types";

/** Add one source range and normalize overlaps without copying on a no-op. */
export function mergeTextCut(
  source: string,
  cuts: readonly TextCut[],
  start: number,
  end: number,
): TextCut[] {
  const boundedStart = Math.max(0, Math.min(start, source.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, source.length));

  if (boundedEnd === boundedStart) {
    // SAFETY: a no-op returns the caller's array unchanged; callers never mutate the result.
    return cuts as TextCut[];
  }
  const ranges = [
    ...cuts.map((cut) => ({ start: cut.start, end: cut.end })),
    { start: boundedStart, end: boundedEnd },
  ]
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, source.length)),
      end: Math.max(0, Math.min(range.end, source.length)),
    }))
    .filter((range) => range.end > range.start)
    .toSorted((left, right) => left.start - right.start || left.end - right.end);
  const merged: Array<{ start: number; end: number }> = [];

  for (const range of ranges) {
    const previous = merged.at(-1);

    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
  }

  return merged.map((range) => ({
    ...range,
    quote: source.slice(range.start, range.end),
  }));
}

/** Restore a selected part of one contiguous character Cut. */
export function restoreTextCut(
  source: string,
  cuts: readonly TextCut[],
  start: number,
  end: number,
): TextCut[] | null {
  const cutIndex = cuts.findIndex((cut) => cut.start <= start && end <= cut.end);

  if (cutIndex === -1 || end <= start) return null;
  const cut = cuts[cutIndex]!;
  const replacements: TextCut[] = [];

  if (cut.start < start) {
    replacements.push({ start: cut.start, end: start, quote: source.slice(cut.start, start) });
  }
  if (end < cut.end) {
    replacements.push({ start: end, end: cut.end, quote: source.slice(end, cut.end) });
  }

  return [...cuts.slice(0, cutIndex), ...replacements, ...cuts.slice(cutIndex + 1)];
}

/** Apply valid source ranges in source order, ignoring stale or overlapping records. */
export function applyTextCuts(source: string, cuts: readonly TextCut[]): string {
  if (cuts.length === 0) return source;
  let cursor = 0;
  const pieces: string[] = [];

  for (const cut of cuts.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    if (cut.start < cursor || cut.start < 0 || cut.end > source.length || cut.end <= cut.start)
      continue;
    if (source.slice(cut.start, cut.end) !== cut.quote) continue;

    pieces.push(source.slice(cursor, cut.start));
    cursor = cut.end;
  }
  pieces.push(source.slice(cursor));

  return pieces.join("");
}

/** Chunk of the base source a block occupies (for restore and display). */
export function sourceChunk(base: string, block: Block): string {
  const lines = base.split("\n");

  return lines.slice(block.lineStart, block.lineEnd + 1).join("\n");
}

/** Remove a work block's lines from the working source (Cut). */
export function cutBlock(working: string, block: Block): string {
  const lines = working.split("\n");
  const before = lines.slice(0, block.lineStart);
  const after = lines.slice(block.lineEnd + 1);

  while (before.length && before[before.length - 1]!.trim() === "") before.pop();

  return [...before, ...after].join("\n");
}

/**
 * Remove exactly the selected block-text range while retaining surrounding
 * Markdown markers. A cross-block range also removes the source between its
 * endpoint characters.
 */
export function cutTextRange(
  working: string,
  startBlock: Block,
  start: number,
  endBlock: Block,
  end: number,
): string {
  const sourceStart = sourceOffsetAt(working, startBlock, start) ?? -1;
  const sourceEnd = sourceOffsetAt(working, endBlock, end) ?? -1;

  if (sourceStart < 0 || sourceEnd <= sourceStart) return working;

  return working.slice(0, sourceStart) + working.slice(sourceEnd);
}

/** The line a restored block re-enters at: the next surviving block's start. */
export function restoreLine(next: Block | undefined, workingLineCount: number): number {
  return next ? next.lineStart : workingLineCount;
}

/**
 * Block-structure signature: kind + text of every block, insensitive to
 * blank-line layout between blocks. NUL separates blocks so no block text
 * can fake a boundary.
 */
function signature(text: string): string {
  return parseBlocks(text)
    .map((block) => block.kind + " " + block.text)
    .join("\0");
}

/**
 * Whether a base block is missing from the working source: the working copy
 * holds fewer blocks with its kind and text than the base does. Only such a
 * block can be restored without duplicating content.
 */
export function isBlockCut(base: string, working: string, block: Block): boolean {
  const matches = (text: string) =>
    parseBlocks(text).filter(
      (candidate) => candidate.kind === block.kind && candidate.text === block.text,
    ).length;

  return matches(working) < matches(base);
}

/**
 * Re-insert a cut base block into the working source before `beforeLine`.
 * Returns undefined when the block structure round-trips to the base content
 * (restore may differ in blank-line placement only) - the working copy is
 * back to pristine and should be dropped.
 */
export function restoreBlock(
  base: string,
  working: string,
  block: Block,
  beforeLine: number,
): string | undefined {
  const lines = working.split("\n");
  const before = lines.slice(0, beforeLine);
  const after = lines.slice(beforeLine);
  const insertedLines = sourceChunk(base, block).split("\n");

  if (before.length && before[before.length - 1]!.trim() !== "") insertedLines.unshift("");
  if (after.length && after[0]!.trim() !== "") insertedLines.push("");
  const restored = [...before, ...insertedLines, ...after].join("\n");

  return signature(restored) === signature(base) ? undefined : restored;
}
