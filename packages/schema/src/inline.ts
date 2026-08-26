/**
 * Inline markdown tokenizer: turns one block's text into styled runs while
 * preserving exact source offsets, so the review surface can conceal the markup
 * markers yet keep quote anchors char-precise.
 *
 * Each run is either VISIBLE text - carrying `start`, its offset in the input -
 * or a CONCEALED marker (`**`, `` ` ``, `[`, `](url)`, ...) with `start: null`.
 * A null run occupies no source offset, exactly like a word-diff removal, so the
 * renderer's offset-mapping (overlayMarks / renderedOffsetFor / workRangeForRendered)
 * paints highlights across the visible letters and skips the markers unchanged.
 *
 * Pure and dependency-free: the parse tree never escapes this module - the only
 * output is the flat run list. Covers the plan subset: **strong**, *em*, `code`,
 * ~~strike~~, [label](url), and backslash escapes. Unbalanced markup falls back
 * to literal text.
 */

/** What a visible run represents; a marker run is concealed markup, no emphasis. */
export type InlineRole = "text" | "strong" | "em" | "code" | "strike" | "link" | "marker";

export interface InlineRun {
  text: string;
  role: InlineRole;
  /** Offset of this run in the input text; null for a concealed marker. */
  start: number | null;
  /** Link target, present only on `link` runs. */
  href?: string;
}

/** An emphasis span opened by a delimiter at some index, once its close is found. */
interface Span {
  /** Length of the opening marker (e.g. 2 for `**`). */
  openLength: number;
  /** Length of the closing marker. */
  closeLength: number;
  /** Index in `text` where the closing marker starts. */
  closeIndex: number;
  /** Emphasis role applied to the span's (recursively parsed) content. */
  role: "strong" | "em" | "strike";
}

const PUNCTUATION = new Set(["*", "_", "`", "~", "[", "]", "(", ")", "\\"]);

/** Tokenize one block's text into visible + concealed-marker runs, in order. */
export function inlineRuns(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  tokenize(text, 0, "text", runs);
  return runs;
}

/**
 * Walk `source` (whose first character sits at absolute offset `base`), emitting
 * plain text as `role` runs and recursing into emphasis spans. Links and code
 * spans are handled inline because their content is not further emphasized the
 * same way.
 */
function tokenize(source: string, base: number, role: InlineRole, out: InlineRun[]): void {
  let plainStart = 0;
  let cursor = 0;
  const flushPlain = (end: number): void => {
    if (end > plainStart) {
      out.push({ text: source.slice(plainStart, end), role, start: base + plainStart });
    }
  };

  while (cursor < source.length) {
    const char = source[cursor]!;

    if (char === "\\" && cursor + 1 < source.length && PUNCTUATION.has(source[cursor + 1]!)) {
      flushPlain(cursor);
      out.push({ text: "\\", role: "marker", start: null });
      out.push({ text: source[cursor + 1]!, role, start: base + cursor + 1 });
      cursor += 2;
      plainStart = cursor;
      continue;
    }

    const link = matchLink(source, cursor);
    if (link) {
      flushPlain(cursor);
      out.push({ text: source.slice(cursor, link.labelStart), role: "marker", start: null });
      out.push({
        text: source.slice(link.labelStart, link.labelEnd),
        role: "link",
        start: base + link.labelStart,
        href: source.slice(link.hrefStart, link.hrefEnd),
      });
      out.push({ text: source.slice(link.labelEnd, link.end), role: "marker", start: null });
      cursor = link.end;
      plainStart = cursor;
      continue;
    }

    const code = matchCode(source, cursor);
    if (code) {
      flushPlain(cursor);
      out.push({ text: source.slice(cursor, code.contentStart), role: "marker", start: null });
      out.push({
        text: source.slice(code.contentStart, code.contentEnd),
        role: "code",
        start: base + code.contentStart,
      });
      out.push({ text: source.slice(code.contentEnd, code.end), role: "marker", start: null });
      cursor = code.end;
      plainStart = cursor;
      continue;
    }

    const span = matchEmphasis(source, cursor);
    if (span) {
      flushPlain(cursor);
      out.push({
        text: source.slice(cursor, cursor + span.openLength),
        role: "marker",
        start: null,
      });
      const contentStart = cursor + span.openLength;
      tokenize(source.slice(contentStart, span.closeIndex), base + contentStart, span.role, out);
      out.push({
        text: source.slice(span.closeIndex, span.closeIndex + span.closeLength),
        role: "marker",
        start: null,
      });
      cursor = span.closeIndex + span.closeLength;
      plainStart = cursor;
      continue;
    }

    cursor++;
  }
  flushPlain(source.length);
}

/** A `[label](url)` link at `index`, or null. Empty label or url does not match. */
function matchLink(
  text: string,
  index: number,
): {
  labelStart: number;
  labelEnd: number;
  hrefStart: number;
  hrefEnd: number;
  end: number;
} | null {
  if (text[index] !== "[") return null;
  const labelStart = index + 1;
  const labelEnd = text.indexOf("]", labelStart);
  if (labelEnd < 0 || labelEnd === labelStart) return null;
  if (text[labelEnd + 1] !== "(") return null;
  const hrefStart = labelEnd + 2;
  // the destination may carry balanced parentheses (wiki URLs); the span ends
  // at the first unmatched closer
  let depth = 0;
  for (let scan = hrefStart; scan < text.length; scan++) {
    const character = text[scan];
    if (character === "(") depth++;
    else if (character === ")") {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (scan === hrefStart) return null;
      return { labelStart, labelEnd, hrefStart, hrefEnd: scan, end: scan + 1 };
    }
  }
  return null;
}

/** A `` `code` `` span at `index` (n backticks .. n backticks), or null. */
function matchCode(
  text: string,
  index: number,
): { contentStart: number; contentEnd: number; end: number } | null {
  if (text[index] !== "`") return null;
  let fence = 0;
  while (text[index + fence] === "`") fence++;
  const contentStart = index + fence;
  const closer = "`".repeat(fence);
  const contentEnd = text.indexOf(closer, contentStart);
  if (contentEnd < 0 || contentEnd === contentStart) return null;
  return { contentStart, contentEnd, end: contentEnd + fence };
}

/** A `**strong**`, `*em*`, or `~~strike~~` span at `index`, or null. */
function matchEmphasis(text: string, index: number): Span | null {
  const two = text.slice(index, index + 2);
  if (two === "**") return closingSpan(text, index, 2, "strong");
  if (two === "~~") return closingSpan(text, index, 2, "strike");
  if (text[index] === "*") return closingSpan(text, index, 1, "em");
  return null;
}

/** Find the matching close for a marker of `length` at `index`; null if unbalanced. */
function closingSpan(
  text: string,
  index: number,
  length: number,
  role: "strong" | "em" | "strike",
): Span | null {
  const marker = text.slice(index, index + length);
  const contentStart = index + length;
  const closeIndex =
    length === 1 ? findLoneStar(text, contentStart) : text.indexOf(marker, contentStart);
  if (closeIndex < 0 || closeIndex === contentStart) return null; // unbalanced or empty
  return { openLength: length, closeLength: length, closeIndex, role };
}

/** Index of the next standalone `*` (not part of a `**` run), or -1. */
function findLoneStar(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    if (text[index] === "*") {
      if (text[index + 1] !== "*") return index;
      while (text[index] === "*") index++; // skip the whole `**` run
      continue;
    }
    index++;
  }
  return -1;
}
