/**
 * Scan raw markdown source into highlight ranges for the inline thread editor.
 * The scheme is deliberately restrained, matching a plain markdown editor: a
 * heading dims its `#` marker and bolds the title text (no color); links render
 * in one link color; inline and fenced code gray out. Everything else - bold,
 * emphasis, list and quote markers, rules - stays plain source. Block structure
 * reuses the schema parser so a heading or code fence is defined in one place.
 */

import { parseBlocks, LEADING_BLOCK_MARKER, type Block } from "@cueloop/schema";

/** Every markdown token class the editor paints; "marker" is the dimmed heading punctuation. */
export const MARKDOWN_HIGHLIGHT_GROUPS = ["heading", "marker", "link", "code"] as const;

/** A markdown token class the editor paints. */
export type MarkdownHighlightGroup = (typeof MARKDOWN_HIGHLIGHT_GROUPS)[number];

/** A char range in the raw markdown source to paint with one group's style; end is exclusive. */
export interface MarkdownHighlightRange {
  start: number;
  end: number;
  group: MarkdownHighlightGroup;
}

/** The absolute source offset where each 0-based line begins. */
function lineStartOffsets(source: string): number[] {
  const offsets = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") offsets.push(index + 1);
  }

  return offsets;
}

// Inline code (a balanced backtick run) grays out; a [text](href) link colors as one run. Nothing else
// inline is styled - bold and emphasis stay plain source.
const INLINE_TOKEN = /(`+)(?:.+?)\1|\[[^\]]+\]\([^)]+\)/g;

/** Gray inline code and color links found in one text span; other inline markup stays plain. */
function scanInlineTokens(text: string, base: number, into: MarkdownHighlightRange[]): void {
  INLINE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    const start = base + match.index;
    const end = start + match[0].length;

    into.push({ start, end, group: match[0].startsWith("`") ? "code" : "link" });
  }
}

function isHeadingKind(kind: Block["kind"]): boolean {
  return kind === "h1" || kind === "h2" || kind === "h3";
}

/** Dim a heading's `#` marker and bold the rest of the line (no color). */
function scanHeadingBlock(
  firstLineStart: number,
  source: string,
  lineStarts: number[],
  block: Block,
  into: MarkdownHighlightRange[],
): void {
  const lineText = source.slice(firstLineStart, lineStarts[block.lineStart + 1] ?? source.length);
  const marker = lineText.match(LEADING_BLOCK_MARKER)?.[0] ?? "";

  into.push({ start: firstLineStart, end: firstLineStart + marker.length, group: "marker" });
  into.push({
    start: firstLineStart + marker.length,
    end: firstLineStart + lineText.trimEnd().length,
    group: "heading",
  });
}

/** Paint one block: heading marker and title, grayed code block, or inline code and links in prose. */
function scanBlock(
  block: Block,
  source: string,
  lineStarts: number[],
  into: MarkdownHighlightRange[],
): void {
  const firstLineStart = lineStarts[block.lineStart] ?? 0;

  if (isHeadingKind(block.kind)) {
    scanHeadingBlock(firstLineStart, source, lineStarts, block, into);
  } else if (block.kind === "code") {
    into.push({
      start: firstLineStart,
      end: lineStarts[block.lineEnd + 1] ?? source.length,
      group: "code",
    });
  } else if (block.kind !== "hr") {
    for (let line = block.lineStart; line <= block.lineEnd; line++) {
      const lineStart = lineStarts[line] ?? source.length;
      const lineText = source.slice(lineStart, lineStarts[line + 1] ?? source.length);

      scanInlineTokens(lineText.replace(/\r?\n$/, ""), lineStart, into);
    }
  }
}

/** Scan raw markdown source into highlight ranges over the source (markers included), for the inline editor. */
export function markdownHighlightRanges(source: string): MarkdownHighlightRange[] {
  const lineStarts = lineStartOffsets(source);
  const ranges: MarkdownHighlightRange[] = [];

  for (const block of parseBlocks(source)) scanBlock(block, source, lineStarts, ranges);

  return ranges;
}
