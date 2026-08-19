/**
 * Anchor resolution: the quote-primary cascade. Anchors resolve against the
 * current block list:
 *   1. exact quote in a block (prefix/suffix selectors break ties,
 *      position hint breaks remaining ties)
 *   2. trimmed quote
 *   3. orphan - keep the quote for display, drop the highlight.
 * Never silently bind to the wrong text.
 */

import type { Anchor } from "./types";
import type { Block } from "./markdown";

/** Characters of surrounding text captured as prefix/suffix selectors. */
const ANCHOR_CONTEXT_CHARS = 24;

export interface ResolvedAnchor {
  blockIndex: number;
  start: number;
  end: number;
  /** True when the quote had to be trimmed to bind. */
  approximate: boolean;
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

interface Candidate extends ResolvedAnchor {
  score: number;
}

function findCandidates(anchor: Anchor, blocks: Block[], quote: string): Candidate[] {
  const candidates: Candidate[] = [];
  blocks.forEach((block, blockIndex) => {
    const text = block.text;
    for (
      let matchStart = text.indexOf(quote);
      matchStart !== -1;
      matchStart = text.indexOf(quote, matchStart + 1)
    ) {
      const prefix = text.slice(Math.max(0, matchStart - ANCHOR_CONTEXT_CHARS), matchStart);
      const suffix = text.slice(
        matchStart + quote.length,
        matchStart + quote.length + ANCHOR_CONTEXT_CHARS,
      );
      let score = 0;
      if (prefix === anchor.prefix) score += 2;
      if (suffix === anchor.suffix) score += 2;
      if (anchor.blockIndex === blockIndex) score += 1;
      if (anchor.blockIndex === blockIndex && anchor.start === matchStart) score += 1;
      candidates.push({
        blockIndex,
        start: matchStart,
        end: matchStart + quote.length,
        approximate: false,
        score,
      });
    }
  });
  return candidates;
}

/** Resolve an anchor against the current blocks, or null when orphaned. */
export function resolveAnchor(anchor: Anchor, blocks: Block[]): ResolvedAnchor | null {
  if (anchor.quote === "") return null;
  let candidates = findCandidates(anchor, blocks, anchor.quote);
  let approximate = false;
  if (candidates.length === 0) {
    const trimmed = anchor.quote.trim();
    if (trimmed !== "" && trimmed !== anchor.quote) {
      candidates = findCandidates(anchor, blocks, trimmed);
      approximate = true;
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0]!;
  return { ...best, approximate };
}
