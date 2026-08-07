/**
 * Anchor resolution: the quote-primary cascade (map #2, #22, verified in the
 * edit-mode deep-dive). Anchors resolve against the current block list:
 *   1. exact quote in a block (prefix/suffix selectors break ties,
 *      position hint breaks remaining ties)
 *   2. trimmed quote
 *   3. orphan - keep the quote for display, drop the highlight.
 * Never silently bind to the wrong text.
 */

import type { Anchor } from "./types";
import type { Block } from "./markdown";

const CONTEXT = 24;

export interface ResolvedAnchor {
  blockIndex: number;
  start: number;
  end: number;
  /** True when the quote had to be trimmed to bind. */
  approximate: boolean;
}

export function makeAnchor(blocks: Block[], blockIndex: number, start: number, end: number): Anchor {
  const t = blocks[blockIndex]?.text ?? "";
  return {
    quote: t.slice(start, end),
    prefix: t.slice(Math.max(0, start - CONTEXT), start),
    suffix: t.slice(end, end + CONTEXT),
    blockIndex,
    start,
    end,
  };
}

interface Candidate extends ResolvedAnchor {
  score: number;
}

function findCandidates(anchor: Anchor, blocks: Block[], quote: string): Candidate[] {
  const out: Candidate[] = [];
  blocks.forEach((b, blockIndex) => {
    const text = b.text;
    for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) {
      const pre = text.slice(Math.max(0, i - CONTEXT), i);
      const suf = text.slice(i + quote.length, i + quote.length + CONTEXT);
      let score = 0;
      if (pre === anchor.prefix) score += 2;
      if (suf === anchor.suffix) score += 2;
      if (anchor.blockIndex === blockIndex) score += 1;
      if (anchor.blockIndex === blockIndex && anchor.start === i) score += 1;
      out.push({ blockIndex, start: i, end: i + quote.length, approximate: false, score });
    }
  });
  return out;
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
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  return { ...best, approximate };
}
