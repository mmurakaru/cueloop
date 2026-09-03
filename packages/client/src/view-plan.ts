/**
 * The plan projection pipeline: parse → display blocks (base vs working
 * copy reconciled) → styled runs. Pure functions - the TUI renders the runs
 * (the native text primitive wraps them), tests assert on them directly.
 * One planning layer: rendering, navigation, and selection all derive from
 * this module; the rendered/work offset mappings keep the native selection
 * addressable over word-diffed blocks.
 */

import {
  inlineRuns,
  isAddressed,
  lcsDiff,
  parseBlocks,
  resolveAnchor,
  type Annotation,
  type Block,
} from "@cueloop/schema";
import { wordLevelChanges } from "./diff-intraline";
import { spanRangeInBlock, type TextSpan } from "./thread-selection";

// ── display model ─────────────────────────────

export type DisplayType = "same" | "mod" | "del" | "add";

export interface DisplayBlock {
  type: DisplayType;
  kind: Block["kind"];
  /** Block in the working copy (absent for del). */
  work?: Block;
  /** Block in the submitted revision (absent for add). */
  base?: Block;
  orderedItemNumber?: number;
}

export function displayText(block: DisplayBlock): string {
  return (block.work ?? block.base)!.text;
}

/** Word-overlap similarity gate: an unrelated cut + insert must not merge. */
function similar(baseBlock: Block, workBlock: Block): boolean {
  if (baseBlock.kind !== workBlock.kind) return false;
  const words = (text: string) => new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
  const baseWords = words(baseBlock.text);
  const workWords = words(workBlock.text);
  let intersection = 0;

  for (const word of baseWords) if (workWords.has(word)) intersection++;
  const union = baseWords.size + workWords.size - intersection;

  return union === 0 ? true : intersection / union >= 0.3;
}

/** Reconcile base blocks vs working blocks into the display list. */
export function buildDisplay(baseContent: string, workingContent?: string): DisplayBlock[] {
  const baseBlocks = parseBlocks(baseContent);

  if (workingContent === undefined) {
    const display: DisplayBlock[] = baseBlocks.map((block) => ({
      type: "same",
      kind: block.kind,
      work: block,
      base: block,
    }));

    numberOrderedListItems(display);

    return display;
  }
  const workBlocks = parseBlocks(workingContent);
  const signature = (block: Block) => block.kind + "\0" + block.text;
  const ops = lcsDiff(
    baseBlocks,
    workBlocks,
    (baseBlock, workBlock) => signature(baseBlock) === signature(workBlock),
  );
  const display: DisplayBlock[] = [];
  let opIndex = 0;

  while (opIndex < ops.length) {
    const op = ops[opIndex]!;

    if (op.kind === "ctx") {
      display.push({ type: "same", kind: op.newValue!.kind, work: op.newValue, base: op.oldValue });
      opIndex++;
      continue;
    }
    const deletedBlocks: Block[] = [];
    const addedBlocks: Block[] = [];

    while (opIndex < ops.length && ops[opIndex]!.kind !== "ctx") {
      const changeOp = ops[opIndex]!;

      if (changeOp.kind === "del") deletedBlocks.push(changeOp.oldValue!);
      else addedBlocks.push(changeOp.newValue!);
      opIndex++;
    }
    let deletedIndex = 0;
    let addedIndex = 0;

    while (deletedIndex < deletedBlocks.length && addedIndex < addedBlocks.length) {
      if (similar(deletedBlocks[deletedIndex]!, addedBlocks[addedIndex]!)) {
        display.push({
          type: "mod",
          kind: addedBlocks[addedIndex]!.kind,
          base: deletedBlocks[deletedIndex]!,
          work: addedBlocks[addedIndex]!,
        });
        deletedIndex++;
        addedIndex++;
      } else if (deletedBlocks.length - deletedIndex >= addedBlocks.length - addedIndex) {
        display.push({
          type: "del",
          kind: deletedBlocks[deletedIndex]!.kind,
          base: deletedBlocks[deletedIndex]!,
        });
        deletedIndex++;
      } else {
        display.push({
          type: "add",
          kind: addedBlocks[addedIndex]!.kind,
          work: addedBlocks[addedIndex]!,
        });
        addedIndex++;
      }
    }
    while (deletedIndex < deletedBlocks.length) {
      display.push({
        type: "del",
        kind: deletedBlocks[deletedIndex]!.kind,
        base: deletedBlocks[deletedIndex++]!,
      });
    }
    while (addedIndex < addedBlocks.length) {
      display.push({
        type: "add",
        kind: addedBlocks[addedIndex]!.kind,
        work: addedBlocks[addedIndex++]!,
      });
    }
  }
  numberOrderedListItems(display);

  return display;
}

function numberOrderedListItems(display: DisplayBlock[]): void {
  let runLength = 0;

  for (const block of display) {
    if (block.kind === "oli") block.orderedItemNumber = ++runLength;
    else runLength = 0;
  }
}

// ── marks (annotation highlights + keyboard span) ──

export type RunRole =
  | "plain"
  | "ins"
  | "del"
  | "mark-comment"
  | "kspan"
  | "mark-focus"
  | "strong"
  | "em"
  | "code"
  | "strike"
  | "link";

export interface StyleRun {
  text: string;
  role: RunRole;
  /** Offset of this run in the block's working text; null for del runs. */
  start: number | null;
  annotationId?: string;
  /** Link target for `link` runs. */
  href?: string;
}

export interface Mark {
  start: number;
  end: number;
  role: RunRole;
  annotationId?: string;
  /** The whole anchored stretch in display coordinates; one thread per span. */
  span?: TextSpan;
}

/**
 * Resolve annotations against the working blocks and group marks per display
 * index. Working blocks are the blocks of (workingCopy ?? artifact) - the
 * same list buildDisplay derived work entries from.
 */
export function marksByDisplay(
  annotations: Annotation[],
  display: DisplayBlock[],
  focusedId?: string,
): Map<number, Mark[]> {
  // block list in "work space": display entries that carry a work block, in order
  const workEntries = display
    .map((block, displayIndex) => ({ block, displayIndex }))
    .filter((entry) => entry.block.work !== undefined);
  const workBlocks = workEntries.map((entry) => entry.block.work!);
  const marksByIndex = new Map<number, Mark[]>();

  for (const annotation of annotations) {
    // an addressed annotation keeps its record but paints no highlight
    if (isAddressed(annotation)) continue;
    const resolved = resolveAnchor(annotation.anchor, workBlocks);

    if (!resolved) continue;
    const startEntry = workEntries[resolved.blockIndex];
    const endEntry = workEntries[resolved.endBlockIndex];

    if (!startEntry || !endEntry) continue;
    const span: TextSpan = {
      start: { blockIndex: startEntry.displayIndex, char: resolved.start },
      end: { blockIndex: endEntry.displayIndex, char: resolved.end },
    };

    // a span paints on every block it covers; the mark carries the whole span
    for (let workIndex = resolved.blockIndex; workIndex <= resolved.endBlockIndex; workIndex++) {
      const entry = workEntries[workIndex]!;
      const range = spanRangeInBlock(span, entry.displayIndex, entry.block.work!.text.length);

      if (!range) continue;
      const marks = marksByIndex.get(entry.displayIndex) ?? [];

      marks.push({
        start: range.start,
        end: range.end,
        role: annotation.id === focusedId ? "mark-focus" : "mark-comment",
        annotationId: annotation.id,
        span,
      });
      marksByIndex.set(entry.displayIndex, marks);
    }
  }

  return marksByIndex;
}

/** Base runs for a display block: plain text, or word-diff for mod blocks. */
export function blockRuns(block: DisplayBlock, markup: boolean): StyleRun[] {
  const literal = block.kind === "code" || block.kind === "hr";

  if (block.type === "mod" && markup) {
    const changes = wordLevelChanges(block.base!.text, block.work!.text);
    const runs: StyleRun[] = [];
    let workOffset = 0;

    for (const change of changes) {
      if (change.kind === "removed") {
        runs.push({ text: change.text, role: "del", start: null });
        continue;
      }
      // A code/rule block stays literal; prose segments inline-tokenize so their
      // markers conceal while their work offsets stay intact. Added text keeps
      // the green diff role (it wins over emphasis); context text shows emphasis.
      const segment = literal
        ? [{ text: change.text, role: "plain" as const, start: workOffset }]
        : inlineStyleRuns(change.text, workOffset);

      for (const run of segment) {
        runs.push(change.kind === "added" ? { ...run, role: "ins" } : run);
      }
      workOffset += change.text.length;
    }

    return runs;
  }
  const text = displayText(block);

  // Prose carries inline markup; code fences and rules are literal. Concealed
  // markers are dropped, so every rendered cell still maps to a work offset.
  if (markup && !literal) {
    return inlineStyleRuns(text, 0);
  }

  return [{ text, role: "plain", start: 0 }];
}

/** A link href safe to hand a terminal as an OSC 8 target, or undefined. Only
 *  http(s) and mailto are trusted; a scheme like javascript: is dropped. The
 *  target must stay printable ASCII: a control byte (ESC, BEL) in a reviewed
 *  document could otherwise splice into the terminal escape stream. */
export function safeLinkHref(href: string | undefined): string | undefined {
  if (href === undefined) return undefined;
  if (!/^(https?:|mailto:)/i.test(href)) return undefined;

  return /^[\x21-\x7e]+$/.test(href) ? href : undefined;
}

/**
 * Map the schema inline tokens to positioned StyleRuns, dropping the concealed
 * markers. `base` is the run's offset within the block's working text (0 for a
 * whole prose block; a segment's start for a word-diff piece).
 */
export function inlineStyleRuns(text: string, base: number): StyleRun[] {
  const runs: StyleRun[] = [];

  for (const run of inlineRuns(text)) {
    if (run.role === "marker" || run.start === null) continue;
    const styleRun: StyleRun = {
      text: run.text,
      role: run.role === "text" ? "plain" : run.role,
      start: base + run.start,
    };

    if (run.href !== undefined) styleRun.href = run.href;
    runs.push(styleRun);
  }

  return runs;
}

/** Split runs at mark boundaries; marks only bind to runs with offsets. */
export function overlayMarks(runs: StyleRun[], marks: Mark[]): StyleRun[] {
  if (!marks.length) return runs;
  const splitRuns: StyleRun[] = [];

  for (const run of runs) {
    if (run.start === null) {
      splitRuns.push(run);
      continue;
    }
    const bounds = new Set<number>([0, run.text.length]);

    for (const mark of marks) {
      const boundStart = Math.max(0, mark.start - run.start);
      const boundEnd = Math.min(run.text.length, mark.end - run.start);

      if (boundStart < boundEnd) {
        bounds.add(boundStart);
        bounds.add(boundEnd);
      }
    }
    const runStart = run.start;
    const boundaries = [...bounds].sort((left, right) => left - right);

    for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex++) {
      const sliceStart = boundaries[boundaryIndex]!;
      const sliceEnd = boundaries[boundaryIndex + 1]!;

      if (sliceStart >= sliceEnd) continue;
      const absoluteStart = runStart + sliceStart;
      const mark = marks.find(
        (candidate) => candidate.start <= absoluteStart && runStart + sliceEnd <= candidate.end,
      );

      splitRuns.push({
        text: run.text.slice(sliceStart, sliceEnd),
        // a mark never overrides ins/del emphasis; it rides on plain text
        role: mark && run.role === "plain" ? mark.role : run.role,
        start: absoluteStart,
        annotationId: mark?.annotationId ?? run.annotationId,
      });
    }
  }

  return splitRuns;
}

/**
 * Rendered-text offset of a work-text offset within a block's runs. The
 * rendered text is every run's text in order (inline del runs included);
 * only positioned runs carry work offsets. Drives the renderer's native
 * selection from keyboard span offsets - the quote-anchor path depends on
 * this mapping staying exact.
 */
export function renderedOffsetFor(runs: StyleRun[], workOffset: number): number | null {
  let rendered = 0;

  for (const run of runs) {
    if (run.start !== null && workOffset >= run.start && workOffset < run.start + run.text.length) {
      return rendered + (workOffset - run.start);
    }
    rendered += run.text.length;
  }

  return null;
}

/**
 * Rendered offset of the first positioned character at or after `workOffset`.
 * A word span may start on a concealed marker (the `**` of an emphasized
 * word), which has no rendered cell; the span visuals snap to the first
 * character that does. Positioned runs appear in ascending work order.
 */
export function renderedOffsetAtOrAfter(runs: StyleRun[], workOffset: number): number | null {
  let rendered = 0;

  for (const run of runs) {
    if (run.start !== null && run.start + run.text.length > workOffset) {
      return rendered + Math.max(0, workOffset - run.start);
    }
    rendered += run.text.length;
  }

  return null;
}

/**
 * Rendered offset of the last positioned character at or before `workOffset` -
 * the closing-marker counterpart of `renderedOffsetAtOrAfter`.
 */
export function renderedOffsetAtOrBefore(runs: StyleRun[], workOffset: number): number | null {
  let rendered = 0;
  let best: number | null = null;

  for (const run of runs) {
    if (run.start !== null && run.start <= workOffset) {
      best = rendered + Math.min(workOffset - run.start, run.text.length - 1);
    }
    rendered += run.text.length;
  }

  return best;
}

/**
 * Work-text range covered by a rendered-text selection [start, end). Del runs
 * and other unpositioned text inside the selection contribute nothing; the
 * result is the tightest work range whose text the selection touched.
 */
export function workRangeForRendered(
  runs: StyleRun[],
  renderedStart: number,
  renderedEnd: number,
): { start: number; end: number } | null {
  let rendered = 0;
  let range: { start: number; end: number } | null = null;

  for (const run of runs) {
    const runRenderedStart = rendered;
    const runRenderedEnd = rendered + run.text.length;

    rendered = runRenderedEnd;
    if (run.start === null) continue;
    const overlapStart = Math.max(renderedStart, runRenderedStart);
    const overlapEnd = Math.min(renderedEnd, runRenderedEnd);

    if (overlapEnd <= overlapStart) continue;
    const workStart = run.start + (overlapStart - runRenderedStart);
    const workEnd = run.start + (overlapEnd - runRenderedStart);

    if (!range) range = { start: workStart, end: workEnd };
    else {
      range.start = Math.min(range.start, workStart);
      range.end = Math.max(range.end, workEnd);
    }
  }

  return range;
}

/** Line delta between two revision contents, for the sheet-header summary. */
export function revisionDelta(previousContent: string, nextContent: string) {
  const ops = lcsDiff(previousContent.split("\n"), nextContent.split("\n"));
  let added = 0;
  let removed = 0;

  for (const op of ops) {
    if (op.kind === "add") added++;
    else if (op.kind === "del") removed++;
  }

  return { added, removed };
}

// ── keyboard span mode ────────────────────────

export interface SpanState {
  displayIndex: number;
  wordIndex: number;
  wordEnd: number;
  start: number;
  end: number;
}

export function wordRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const wordPattern = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = wordPattern.exec(text)))
    ranges.push([match.index, match.index + match[0]!.length]);

  return ranges;
}

export function startSpan(displayIndex: number, text: string): SpanState | null {
  const words = wordRanges(text);

  if (!words.length) return null;

  return { displayIndex, wordIndex: 0, wordEnd: 0, start: words[0]![0], end: words[0]![1] };
}

/**
 * Build a word-granular span from a raw char range (a mouse drag-selection),
 * snapping to every word the range overlaps so w/b/l/h keep working after. Null
 * when the range covers no word.
 */
export function spanFromRange(
  displayIndex: number,
  text: string,
  start: number,
  end: number,
): SpanState | null {
  const words = wordRanges(text);
  const wordIndex = words.findIndex((word) => word[1] > start);

  if (wordIndex === -1) return null;
  let wordEnd = wordIndex;

  for (let index = wordIndex; index < words.length && words[index]![0] < end; index++) {
    wordEnd = index;
  }

  return {
    displayIndex,
    wordIndex,
    wordEnd,
    start: words[wordIndex]![0],
    end: words[wordEnd]![1],
  };
}

export function spanKey(span: SpanState, key: string, text: string): SpanState {
  const words = wordRanges(text);
  const nextSpan = { ...span };
  const width = nextSpan.wordEnd - nextSpan.wordIndex;

  if (key === "l") nextSpan.wordEnd = Math.min(words.length - 1, nextSpan.wordEnd + 1);
  else if (key === "h") nextSpan.wordEnd = Math.max(nextSpan.wordIndex, nextSpan.wordEnd - 1);
  else if (key === "w") {
    const slidTo = Math.min(words.length - 1 - width, nextSpan.wordIndex + 1);

    nextSpan.wordIndex = slidTo;
    nextSpan.wordEnd = slidTo + width;
  } else if (key === "b") {
    const slidTo = Math.max(0, nextSpan.wordIndex - 1);

    nextSpan.wordIndex = slidTo;
    nextSpan.wordEnd = slidTo + width;
  } else if (key === "$") nextSpan.wordEnd = words.length - 1;
  else if (key === "0") {
    nextSpan.wordEnd = width;
    nextSpan.wordIndex = 0;
  } else return span;
  nextSpan.start = words[nextSpan.wordIndex]![0];
  nextSpan.end = words[nextSpan.wordEnd]![1];

  return nextSpan;
}

// ── working-copy block operations ─────────────

/** The next work block after a display index (a del block re-enters before it). */
export function nextWorkBlock(display: DisplayBlock[], displayIndex: number): Block | undefined {
  for (let candidateIndex = displayIndex + 1; candidateIndex < display.length; candidateIndex++) {
    const workBlock = display[candidateIndex]!.work;

    if (workBlock) return workBlock;
  }

  return undefined;
}
