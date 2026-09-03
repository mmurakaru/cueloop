/**
 * Anchor resolution: the quote-primary cascade. Anchors resolve against the
 * current block list, each tier tried only when the one above it misses:
 *   1. exact      - the quote appears verbatim in a block
 *   2. trimmed    - the quote appears once surrounding whitespace is dropped
 *   3. normalized - the quote appears once a leading markdown block marker
 *                   (bullet, heading, ordered, quote) is stripped, matching how
 *                   the parser strips block text
 *   4. fuzzy      - the quote was lightly edited but is still recognizably there
 *   5. orphan     - none matched; keep the quote for display, drop the highlight
 * Prefix/suffix selectors and the recorded position break ties within a tier.
 * Never silently bind to the wrong text: fuzzy needs a high similarity floor.
 *
 * A quote may span consecutive blocks: its text is the blocks' text joined by
 * BLOCK_SEPARATOR, and it resolves against the document joined the same way,
 * so one comment can cover the tail of a paragraph and the bullets under it.
 */

import type { Anchor } from "./types";
import { type Block, stripLeadingBlockMarker } from "./markdown";
import { fuzzyFindBestMatch } from "./fuzzy";

/** Characters of surrounding text captured as prefix/suffix selectors. */
const ANCHOR_CONTEXT_CHARS = 24;

/** Minimum similarity a fuzzy match needs before the resolver will trust it. */
const FUZZY_MINIMUM_SIMILARITY = 0.75;

/** Joins block texts in a spanning quote and in the document it resolves against. */
export const BLOCK_SEPARATOR = "\n\n";

/** How the quote bound to the block text, weakest binding named last. */
export type AnchorMatchStrategy = "exact" | "trimmed" | "normalized" | "fuzzy";

export interface ResolvedAnchor {
  blockIndex: number;
  start: number;
  /** Last block of the quote; equals blockIndex unless the quote spans blocks. */
  endBlockIndex: number;
  /** Offset within the end block. */
  end: number;
  /** True whenever the binding was not an exact quote match. */
  approximate: boolean;
  /** Which cascade tier bound the quote. */
  strategy: AnchorMatchStrategy;
}

export function makeAnchor(
  blocks: Block[],
  blockIndex: number,
  start: number,
  end: number,
  endBlockIndex: number = blockIndex,
): Anchor {
  const startText = blocks[blockIndex]?.text ?? "";
  const endText = blocks[endBlockIndex]?.text ?? "";
  const quote = blocks
    .slice(blockIndex, endBlockIndex + 1)
    .map((block, offset, spanned) => {
      const isFirst = offset === 0;
      const isLast = offset === spanned.length - 1;

      return block.text.slice(isFirst ? start : 0, isLast ? end : block.text.length);
    })
    .join(BLOCK_SEPARATOR);

  const anchor: Anchor = {
    quote,
    prefix: startText.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start),
    suffix: endText.slice(end, end + ANCHOR_CONTEXT_CHARS),
    blockIndex,
    start,
    end,
  };

  if (endBlockIndex !== blockIndex) anchor.endBlockIndex = endBlockIndex;

  return anchor;
}

interface Candidate {
  blockIndex: number;
  start: number;
  end: number;
  score: number;
}

/** Score a candidate window by how well its context and position agree. */
function contextScore(
  anchor: Anchor,
  blockIndex: number,
  block: Block,
  start: number,
  end: number,
): number {
  const prefix = block.text.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start);
  const suffix = block.text.slice(end, end + ANCHOR_CONTEXT_CHARS);
  let score = 0;

  if (prefix === anchor.prefix) score += 2;
  if (suffix === anchor.suffix) score += 2;
  if (anchor.blockIndex === blockIndex) score += 1;
  if (anchor.blockIndex === blockIndex && anchor.start === start) score += 1;

  return score;
}

/** Every verbatim occurrence of `quote` across the blocks, scored by context. */
function findExactCandidates(anchor: Anchor, blocks: Block[], quote: string): Candidate[] {
  const candidates: Candidate[] = [];

  blocks.forEach((block, blockIndex) => {
    const text = block.text;

    for (
      let matchStart = text.indexOf(quote);
      matchStart !== -1;
      matchStart = text.indexOf(quote, matchStart + 1)
    ) {
      const matchEnd = matchStart + quote.length;

      candidates.push({
        blockIndex,
        start: matchStart,
        end: matchEnd,
        score: contextScore(anchor, blockIndex, block, matchStart, matchEnd),
      });
    }
  });

  return candidates;
}

/**
 * How much a full context agreement (0-6) may nudge the fuzzy ranking. Kept far
 * below any real similarity gap so text quality always leads and context only
 * breaks near-ties - a stale position hint must never pull the anchor onto a
 * meaningfully less-similar passage.
 */
const FUZZY_CONTEXT_TIE_BREAK = 0.01;

/** The best fuzzy window per block, ranked by similarity with context as a tiebreak. */
function findFuzzyCandidates(
  anchor: Anchor,
  blocks: Block[],
  needle: string,
  minimumSimilarity: number,
): Candidate[] {
  const candidates: Candidate[] = [];

  blocks.forEach((block, blockIndex) => {
    const match = fuzzyFindBestMatch(needle, block.text, minimumSimilarity);

    if (match === null) return;
    const score =
      match.similarity +
      contextScore(anchor, blockIndex, block, match.start, match.end) * FUZZY_CONTEXT_TIE_BREAK;

    candidates.push({ blockIndex, start: match.start, end: match.end, score });
  });

  return candidates;
}

/** Highest-scoring candidate, or null when there are none. */
function pickBest(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.score - left.score);

  return candidates[0]!;
}

function resolved(candidate: Candidate, strategy: AnchorMatchStrategy): ResolvedAnchor {
  return {
    blockIndex: candidate.blockIndex,
    start: candidate.start,
    endBlockIndex: candidate.blockIndex,
    end: candidate.end,
    approximate: strategy !== "exact",
    strategy,
  };
}

/* ------------------------------------------------ quotes spanning blocks */

/** The blocks as one document, with where each block's text starts in it. */
interface JoinedDocument {
  text: string;
  starts: number[];
}

function joinBlocks(blocks: Block[]): JoinedDocument {
  const starts: number[] = [];
  let text = "";

  blocks.forEach((block, blockIndex) => {
    if (blockIndex > 0) text += BLOCK_SEPARATOR;
    starts.push(text.length);
    text += block.text;
  });

  return { text, starts };
}

/**
 * The block and in-block offset of a document offset. An offset inside a
 * separator belongs to the block after it when it opens a range and to the
 * block before it when it closes one, so a span never starts or ends on the
 * blank line between blocks.
 */
interface BlockOffset {
  blockIndex: number;
  offset: number;
}

function locateInBlocks(
  blocks: Block[],
  starts: number[],
  offset: number,
  edge: "start" | "end",
): BlockOffset {
  let blockIndex = starts.findLastIndex((start) => start <= offset);

  if (blockIndex < 0) blockIndex = 0;
  const blockEnd = starts[blockIndex]! + blocks[blockIndex]!.text.length;

  if (edge === "start" && offset >= blockEnd && blockIndex < blocks.length - 1) {
    return { blockIndex: blockIndex + 1, offset: 0 };
  }
  if (edge === "end" && offset === starts[blockIndex] && blockIndex > 0) {
    return {
      blockIndex: blockIndex - 1,
      offset: blocks[blockIndex - 1]!.text.length,
    };
  }

  return {
    blockIndex,
    offset: Math.min(offset, blockEnd) - starts[blockIndex]!,
  };
}

/** Context agreement plus position hints for a window of the joined document. */
function documentScore(
  anchor: Anchor,
  documentText: string,
  start: number,
  end: number,
  startBlockIndex: number,
): number {
  const prefix = documentText.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start);
  const suffix = documentText.slice(end, end + ANCHOR_CONTEXT_CHARS);
  let score = 0;

  if (prefix === anchor.prefix) score += 2;
  if (suffix === anchor.suffix) score += 2;
  if (anchor.blockIndex === startBlockIndex) score += 1;

  return score;
}

interface DocumentCandidate {
  start: number;
  end: number;
  score: number;
}

function findSpanningExact(
  anchor: Anchor,
  documentText: string,
  quote: string,
  starts: number[],
  blocks: Block[],
): DocumentCandidate[] {
  const candidates: DocumentCandidate[] = [];

  for (
    let matchStart = documentText.indexOf(quote);
    matchStart !== -1;
    matchStart = documentText.indexOf(quote, matchStart + 1)
  ) {
    const matchEnd = matchStart + quote.length;
    const startBlockIndex = locateInBlocks(blocks, starts, matchStart, "start").blockIndex;

    candidates.push({
      start: matchStart,
      end: matchEnd,
      score: documentScore(anchor, documentText, matchStart, matchEnd, startBlockIndex),
    });
  }

  return candidates;
}

function resolvedSpan(
  blocks: Block[],
  starts: number[],
  candidate: DocumentCandidate,
  strategy: AnchorMatchStrategy,
): ResolvedAnchor {
  const startPosition = locateInBlocks(blocks, starts, candidate.start, "start");
  const endPosition = locateInBlocks(blocks, starts, candidate.end, "end");

  return {
    blockIndex: startPosition.blockIndex,
    start: startPosition.offset,
    endBlockIndex: endPosition.blockIndex,
    end: endPosition.offset,
    approximate: strategy !== "exact",
    strategy,
  };
}

/** The cascade for a quote that spans blocks, run over the joined document. */
function resolveSpanningAnchor(anchor: Anchor, blocks: Block[]): ResolvedAnchor | null {
  const document = joinBlocks(blocks);
  const best = (candidates: DocumentCandidate[]): DocumentCandidate | null =>
    candidates.toSorted((left, right) => right.score - left.score)[0] ?? null;

  const exact = best(
    findSpanningExact(anchor, document.text, anchor.quote, document.starts, blocks),
  );

  if (exact) return resolvedSpan(blocks, document.starts, exact, "exact");

  const trimmedQuote = anchor.quote.trim();

  if (trimmedQuote !== anchor.quote) {
    const trimmed = best(
      findSpanningExact(anchor, document.text, trimmedQuote, document.starts, blocks),
    );

    if (trimmed) return resolvedSpan(blocks, document.starts, trimmed, "trimmed");
  }

  const fuzzy = fuzzyFindBestMatch(trimmedQuote, document.text, FUZZY_MINIMUM_SIMILARITY);

  if (fuzzy) {
    return resolvedSpan(
      blocks,
      document.starts,
      { start: fuzzy.start, end: fuzzy.end, score: 0 },
      "fuzzy",
    );
  }

  return null;
}

/** Resolve an anchor against the current blocks, or null when orphaned. */
export function resolveAnchor(anchor: Anchor, blocks: Block[]): ResolvedAnchor | null {
  if (anchor.quote === "") return null;
  if (anchor.quote.includes(BLOCK_SEPARATOR)) return resolveSpanningAnchor(anchor, blocks);

  const exact = pickBest(findExactCandidates(anchor, blocks, anchor.quote));

  if (exact) return resolved(exact, "exact");

  const trimmedQuote = anchor.quote.trim();

  if (trimmedQuote !== "" && trimmedQuote !== anchor.quote) {
    const trimmed = pickBest(findExactCandidates(anchor, blocks, trimmedQuote));

    if (trimmed) return resolved(trimmed, "trimmed");
  }

  const normalizedQuote = stripLeadingBlockMarker(anchor.quote).trim();

  if (normalizedQuote !== "" && normalizedQuote !== trimmedQuote) {
    const normalized = pickBest(findExactCandidates(anchor, blocks, normalizedQuote));

    if (normalized) return resolved(normalized, "normalized");
  }

  const fuzzyNeedle = normalizedQuote !== "" ? normalizedQuote : trimmedQuote;

  if (fuzzyNeedle !== "") {
    const fuzzy = pickBest(
      findFuzzyCandidates(anchor, blocks, fuzzyNeedle, FUZZY_MINIMUM_SIMILARITY),
    );

    if (fuzzy) return resolved(fuzzy, "fuzzy");
  }

  return null;
}
