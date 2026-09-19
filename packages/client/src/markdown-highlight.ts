/**
 * Scan raw markdown source into highlight ranges for the inline thread editor:
 * given the editable source string (markers and all), return char ranges tagged
 * with a token group so the editor can color headings, bold, italic, inline and
 * fenced code, links, list markers, and blockquotes while the raw syntax stays
 * visible. Block structure reuses the schema parser (one source of truth for
 * what a heading or list marker is); inline emphasis, code, and links are
 * scanned here. Deliberately not full CommonMark - unknown syntax stays plain.
 */

import { parseBlocks, LEADING_BLOCK_MARKER, type Block } from "@cueloop/schema";

/** Every markdown token class the editor paints; "marker" is the dimmed syntax punctuation (`**`, `#`, backticks). */
export const MARKDOWN_HIGHLIGHT_GROUPS = [
  "heading",
  "strong",
  "emphasis",
  "code",
  "link",
  "listMarker",
  "blockquote",
  "rule",
  "marker",
] as const;

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

// A strong, emphasis, inline-code, or link token. Underscore emphasis is guarded by \w boundaries so
// snake_case never italicizes (CommonMark's intra-word rule); asterisk emphasis needs a non-space edge,
// so "2 * 3" stays plain. Inline code matches a balanced backtick run; a link is [text](href).
const INLINE_TOKEN =
  /\*\*(?=\S)(?:.+?)(?<=\S)\*\*|(?<!\w)__(?=\S)(?:.+?)(?<=\S)__(?!\w)|\*(?=\S)(?:.+?)(?<=\S)\*|(?<!\w)_(?=\S)(?:.+?)(?<=\S)_(?!\w)|(`+)(?:.+?)\1|\[[^\]]+\]\([^)]+\)/g;

/** Length of the run of `char` that a token opens with (the emphasis or code delimiter width). */
function openingRunLength(token: string, char: string): number {
  let length = 0;
  while (token[length] === char) length++;

  return length;
}

/** Push emphasis, inline-code, and link ranges found in one text span, with markers dimmed and inner content grouped. */
function scanInlineTokens(text: string, base: number, into: MarkdownHighlightRange[]): void {
  INLINE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    const token = match[0];
    const start = base + match.index;
    const end = start + token.length;

    if (token.startsWith("**") || token.startsWith("__")) {
      pushDelimited(into, start, end, 2, "strong");
    } else if (token.startsWith("*") || token.startsWith("_")) {
      pushDelimited(into, start, end, 1, "emphasis");
    } else if (token.startsWith("`")) {
      pushDelimited(into, start, end, openingRunLength(token, "`"), "code");
    } else {
      // [text](href): dim the brackets and href wrapper, leave the link text in the link color
      const textStart = start + 1;
      const textEnd = start + token.indexOf("](");

      into.push({ start, end: textStart, group: "marker" });
      into.push({ start: textStart, end: textEnd, group: "link" });
      into.push({ start: textEnd, end, group: "marker" });
    }
  }
}

/** A symmetric token (`**bold**`, `_em_`, `` `code` ``): dim the delimiters, color the inner content. */
function pushDelimited(
  into: MarkdownHighlightRange[],
  start: number,
  end: number,
  delimiterLength: number,
  group: MarkdownHighlightGroup,
): void {
  into.push({ start, end: start + delimiterLength, group: "marker" });
  into.push({ start: start + delimiterLength, end: end - delimiterLength, group });
  into.push({ start: end - delimiterLength, end, group: "marker" });
}

function isHeadingKind(kind: Block["kind"]): boolean {
  return kind === "h1" || kind === "h2" || kind === "h3";
}

/** Dim a heading's `#` marker and color the rest of the line. */
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

/** Dim each list or quote marker and scan the remaining prose on every line of the block. */
function scanContentLines(
  block: Block,
  source: string,
  lineStarts: number[],
  into: MarkdownHighlightRange[],
): void {
  const markerGroup: MarkdownHighlightGroup = block.kind === "quote" ? "blockquote" : "listMarker";
  const hasMarker = block.kind === "li" || block.kind === "oli" || block.kind === "quote";

  for (let line = block.lineStart; line <= block.lineEnd; line++) {
    const lineStart = lineStarts[line] ?? source.length;
    const lineText = source.slice(lineStart, lineStarts[line + 1] ?? source.length);
    const marker = hasMarker ? (lineText.match(LEADING_BLOCK_MARKER)?.[0] ?? "") : "";

    if (marker) into.push({ start: lineStart, end: lineStart + marker.length, group: markerGroup });
    scanInlineTokens(
      lineText.slice(marker.length).replace(/\r?\n$/, ""),
      lineStart + marker.length,
      into,
    );
  }
}

/** Paint one block's leading marker plus its content, dispatching by block kind. */
function scanBlock(
  block: Block,
  source: string,
  lineStarts: number[],
  into: MarkdownHighlightRange[],
): void {
  const firstLineStart = lineStarts[block.lineStart] ?? 0;

  if (isHeadingKind(block.kind)) {
    scanHeadingBlock(firstLineStart, source, lineStarts, block, into);
  } else if (block.kind === "hr") {
    const ruleEnd = firstLineStart + source.slice(firstLineStart).search(/\r?\n|$/);

    into.push({ start: firstLineStart, end: ruleEnd, group: "rule" });
  } else if (block.kind === "code") {
    into.push({ start: firstLineStart, end: lineStarts[block.lineEnd + 1] ?? source.length, group: "code" });
  } else {
    scanContentLines(block, source, lineStarts, into);
  }
}

/** Scan raw markdown source into highlight ranges over the source (markers included), for the inline editor. */
export function markdownHighlightRanges(source: string): MarkdownHighlightRange[] {
  const lineStarts = lineStartOffsets(source);
  const ranges: MarkdownHighlightRange[] = [];

  for (const block of parseBlocks(source)) scanBlock(block, source, lineStarts, ranges);

  return ranges;
}
