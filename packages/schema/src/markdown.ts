/**
 * Markdown block model: parse source into addressable blocks with source line
 * ranges and project their text offsets back to source on demand. Round-trip safe for the
 * subset cueloop plans use; unknown constructs fall back to paragraph blocks
 * so no content is ever lost.
 */

export type BlockKind =
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "li"
  | "oli"
  | "quote"
  | "code"
  | "hr"
  | "table"
  | "frontmatter";

export interface Block {
  kind: BlockKind;
  /** Content with markers stripped; code, table, and frontmatter blocks keep inner lines verbatim. */
  text: string;
  /** For code blocks: the fence info string ("ts", "diff", ...). */
  lang?: string;
  /** 0-based inclusive line range in the source this block occupies. */
  lineStart: number;
  lineEnd: number;
}

interface BlockSourceSegment {
  textStart: number;
  textEnd: number;
  sourceStart: number;
}

/**
 * The leading block markers the parser strips from a line: headings (h1-h3),
 * bullet list, ordered list, and blockquote. Single source of truth so the
 * anchor resolver strips exactly the same set and the two never drift.
 */
export const LEADING_BLOCK_MARKER = /^(?:#{1,3} |- |\d+\. |> )/;

/** Remove one leading markdown block marker, or return the line unchanged. */
export function stripLeadingBlockMarker(line: string): string {
  return line.replace(LEADING_BLOCK_MARKER, "");
}

/** A GFM table delimiter row: one or more dash cells split by pipes, each optionally `:`-aligned. */
function isTableDelimiterRow(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|");

  return cells.length >= 1 && cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell));
}

/** A GFM table opens on a header row of pipe cells whose next line is a delimiter row. */
function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];

  return (
    header !== undefined &&
    header.includes("|") &&
    delimiter !== undefined &&
    isTableDelimiterRow(delimiter)
  );
}

function isMarkerLine(line: string): boolean {
  return (
    line.startsWith("```") || LEADING_BLOCK_MARKER.test(line) || /^(---|\*\*\*|___)\s*$/.test(line)
  );
}

/**
 * Leading YAML frontmatter: a --- fence on the very first line, closed by a
 * second --- fence. Null when there is no leading fence or no closing fence -
 * a lone leading --- then falls through to an hr.
 */
function frontmatterBlock(lines: string[]): Block | null {
  if (lines[0]?.trim() !== "---") return null;
  let close = 1;

  while (close < lines.length && lines[close]!.trim() !== "---") close++;
  if (close >= lines.length) return null;

  return {
    kind: "frontmatter",
    text: lines.slice(1, close).join("\n"),
    lineStart: 0,
    lineEnd: close,
  };
}

/** A block consumed from a line span, with the next line to resume parsing at. */
interface BlockScan {
  block: Block;
  next: number;
}

/** A one-line block - a heading, a rule, a bullet, or an ordered item - at `lineIndex`, or null. */
function singleLineBlock(line: string, lineIndex: number): Block | null {
  const marked = (kind: BlockKind): Block => ({
    kind,
    text: stripLeadingBlockMarker(line),
    lineStart: lineIndex,
    lineEnd: lineIndex,
  });

  if (line.startsWith("### ")) return marked("h3");
  if (line.startsWith("## ")) return marked("h2");
  if (line.startsWith("# ")) return marked("h1");
  if (/^(---|\*\*\*|___)\s*$/.test(line)) {
    return { kind: "hr", text: "", lineStart: lineIndex, lineEnd: lineIndex };
  }
  if (line.startsWith("- ")) return marked("li");
  if (/^\d+\. /.test(line)) return marked("oli");

  return null;
}

/** Consume a fenced code block from its opening ``` at `start`. */
function codeBlock(lines: string[], start: number): BlockScan {
  const lang = lines[start]!.slice(3).trim() || undefined;
  let index = start + 1;
  const body: string[] = [];

  while (index < lines.length && !lines[index]!.startsWith("```")) {
    body.push(lines[index]!);
    index++;
  }
  const end = Math.min(index, lines.length - 1);

  return {
    block: { kind: "code", text: body.join("\n"), lang, lineStart: start, lineEnd: end },
    next: index + 1,
  };
}

/** Consume a blockquote's consecutive `> ` lines from `start`. */
function quoteBlock(lines: string[], start: number): BlockScan {
  let index = start;
  const body: string[] = [];

  while (index < lines.length && lines[index]!.startsWith("> ")) {
    body.push(stripLeadingBlockMarker(lines[index]!));
    index++;
  }

  return {
    block: { kind: "quote", text: body.join("\n"), lineStart: start, lineEnd: index - 1 },
    next: index,
  };
}

/** Consume a GFM table (header, delimiter, then pipe rows) from `start`. */
function tableBlock(lines: string[], start: number): BlockScan {
  const body: string[] = [lines[start]!, lines[start + 1]!];
  let index = start + 2;

  // body rows run until a blank line, a fence, or a line without a pipe
  while (
    index < lines.length &&
    lines[index]!.trim() !== "" &&
    lines[index]!.includes("|") &&
    !lines[index]!.startsWith("```")
  ) {
    body.push(lines[index]!);
    index++;
  }

  return {
    block: { kind: "table", text: body.join("\n"), lineStart: start, lineEnd: index - 1 },
    next: index,
  };
}

/** Consume a paragraph: consecutive prose lines until a blank line, a marker, or a table. */
function paragraphBlock(lines: string[], start: number): BlockScan {
  let index = start;
  const body: string[] = [];

  while (
    index < lines.length &&
    lines[index]!.trim() !== "" &&
    !isMarkerLine(lines[index]!) &&
    !isTableStart(lines, index)
  ) {
    body.push(lines[index]!);
    index++;
  }

  return {
    block: { kind: "p", text: body.join("\n"), lineStart: start, lineEnd: index - 1 },
    next: index,
  };
}

/** The next block starting at `lineIndex` (never a blank line, never frontmatter). */
function nextBlock(lines: string[], lineIndex: number): BlockScan {
  const line = lines[lineIndex]!;

  if (line.startsWith("```")) return codeBlock(lines, lineIndex);
  const single = singleLineBlock(line, lineIndex);

  if (single) return { block: single, next: lineIndex + 1 };
  if (line.startsWith("> ")) return quoteBlock(lines, lineIndex);
  if (isTableStart(lines, lineIndex)) return tableBlock(lines, lineIndex);

  return paragraphBlock(lines, lineIndex);
}

/** Project marker-free block text boundaries onto the source consumed by the parser. */
function blockSourceSegments(
  sourceLines: string[],
  block: Block,
): BlockSourceSegment[] | undefined {
  const sourceStart = sourceLines
    .slice(0, block.lineStart)
    .reduce((offset, line) => offset + line.length + 1, 0);
  const rawLines = sourceLines.slice(block.lineStart, block.lineEnd + 1);
  let contentLines: Array<{ rawLine: number; prefix: number }>;

  if (block.kind === "code") {
    const hasClosingFence = rawLines.at(-1)?.startsWith("```") ?? false;
    const end = hasClosingFence ? rawLines.length - 1 : rawLines.length;

    contentLines = rawLines.slice(1, end).map((_, index) => ({ rawLine: index + 1, prefix: 0 }));
  } else if (block.kind === "frontmatter") {
    contentLines = rawLines.slice(1, -1).map((_, index) => ({ rawLine: index + 1, prefix: 0 }));
  } else if (block.kind === "quote") {
    contentLines = rawLines.map((_, rawLine) => ({ rawLine, prefix: 2 }));
  } else if (
    block.kind === "h1" ||
    block.kind === "h2" ||
    block.kind === "h3" ||
    block.kind === "li" ||
    block.kind === "oli"
  ) {
    contentLines = [{ rawLine: 0, prefix: rawLines[0]!.length - block.text.length }];
  } else {
    contentLines = rawLines.map((_, rawLine) => ({ rawLine, prefix: 0 }));
  }
  const content = contentLines
    .map(({ rawLine, prefix }) => rawLines[rawLine]!.slice(prefix))
    .join("\n");

  if (content !== block.text) return undefined;
  const rawLineStarts: number[] = [];
  let rawOffset = 0;

  for (const line of rawLines) {
    rawLineStarts.push(rawOffset);
    rawOffset += line.length + 1;
  }
  let textOffset = 0;
  const segments = contentLines.map(({ rawLine, prefix }) => {
    const line = rawLines[rawLine]!.slice(prefix);
    const lineStart = sourceStart + rawLineStarts[rawLine]! + prefix;
    const segment = {
      textStart: textOffset,
      textEnd: textOffset + line.length,
      sourceStart: lineStart,
    };

    textOffset += line.length + 1;

    return segment;
  });

  return segments;
}

/** Resolve a marker-free block-text boundary through the parser's source projection. */
export function sourceOffsetAt(
  markdown: string,
  block: Block,
  textOffset: number,
): number | undefined {
  for (const segment of blockSourceSegments(markdown.split("\n"), block) ?? []) {
    if (textOffset < segment.textStart || textOffset > segment.textEnd) continue;

    return segment.sourceStart + textOffset - segment.textStart;
  }

  return undefined;
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let lineIndex = 0;
  const frontmatter = frontmatterBlock(lines);

  if (frontmatter) {
    blocks.push(frontmatter);
    lineIndex = frontmatter.lineEnd + 1;
  }
  while (lineIndex < lines.length) {
    if (lines[lineIndex]!.trim() === "") {
      lineIndex++;
      continue;
    }
    const scan = nextBlock(lines, lineIndex);

    blocks.push(scan.block);
    lineIndex = scan.next;
  }

  return blocks;
}

/** Serialize one block back to its markdown chunk. */
export function blockToMd(block: Block, ordinal = 1): string {
  switch (block.kind) {
    case "h1":
      return "# " + block.text;
    case "h2":
      return "## " + block.text;
    case "h3":
      return "### " + block.text;
    case "li":
      return "- " + block.text;
    case "oli":
      return `${ordinal}. ` + block.text;
    case "quote":
      return block.text
        .split("\n")
        .map((line) => "> " + line)
        .join("\n");
    case "code":
      return "```" + (block.lang ?? "") + "\n" + block.text + "\n```";
    case "hr":
      return "---";
    case "frontmatter":
      return "---\n" + block.text + "\n---";
    case "table":
      return block.text;
    default:
      return block.text;
  }
}

/** The section (nearest preceding heading) a block belongs to. */
export function sectionOf(blocks: Block[], index: number): string {
  let sectionTitle = "";

  for (let blockIndex = 0; blockIndex <= index && blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]!;

    if (block.kind === "h1" || block.kind === "h2" || block.kind === "h3")
      sectionTitle = block.text;
  }

  return sectionTitle;
}
