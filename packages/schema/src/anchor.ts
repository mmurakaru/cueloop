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
 */

import type { Anchor } from "./types";
import { type Block, stripLeadingBlockMarker } from "./markdown";
import { fuzzyFindBestMatch } from "./fuzzy";

/** Characters of surrounding text captured as prefix/suffix selectors. */
const ANCHOR_CONTEXT_CHARS = 24;

/** Minimum similarity a fuzzy match needs before the resolver will trust it. */
const FUZZY_MINIMUM_SIMILARITY = 0.75;

/** How the quote bound to the block text, weakest binding named last. */
export type AnchorMatchStrategy = "exact" | "trimmed" | "normalized" | "fuzzy";

export interface ResolvedAnchor {
  blockIndex: number;
  start: number;
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
): Anchor {
  const blockText = blocks[blockIndex]?.text ?? "";

  return {
    quote: blockText.slice(start, end),
    prefix: blockText.slice(Math.max(0, start - ANCHOR_CONTEXT_CHARS), start),
    suffix: blockText.slice(end, end + ANCHOR_CONTEXT_CHARS),
    blockIndex,
    start,
    end,
  };
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
    end: candidate.end,
    approximate: strategy !== "exact",
    strategy,
  };
}

/** Resolve an anchor against the current blocks, or null when orphaned. */
export function resolveAnchor(anchor: Anchor, blocks: Block[]): ResolvedAnchor | null {
  if (anchor.quote === "") return null;

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
