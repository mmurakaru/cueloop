/**
 * Markdown block model: parse source into addressable blocks that record
 * their source line ranges. Rendered-to-source mapping is block+line
 * granular; the quote carries sub-block precision. Round-trip safe for the
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
  const cells = line.trim().replace(/^\||\|$/g, "").split("|");

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

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex]!;

    // YAML frontmatter: a --- fence on the very first line, closed by a second --- fence. A leading
    // --- without a closing fence stays an hr (it falls through to the rule branch below).
    if (lineIndex === 0 && line.trim() === "---") {
      let close = 1;

      while (close < lines.length && lines[close]!.trim() !== "---") close++;
      if (close < lines.length) {
        blocks.push({
          kind: "frontmatter",
          text: lines.slice(1, close).join("\n"),
          lineStart: 0,
          lineEnd: close,
        });
        lineIndex = close + 1;
        continue;
      }
    }
    if (line.trim() === "") {
      lineIndex++;
      continue;
    }
    if (line.startsWith("```")) {
      const start = lineIndex;
      const lang = line.slice(3).trim() || undefined;

      lineIndex++;
      const body: string[] = [];

      while (lineIndex < lines.length && !lines[lineIndex]!.startsWith("```")) {
        body.push(lines[lineIndex]!);
        lineIndex++;
      }
      const end = Math.min(lineIndex, lines.length - 1);

      lineIndex++;
      blocks.push({ kind: "code", text: body.join("\n"), lang, lineStart: start, lineEnd: end });
    } else if (line.startsWith("### ")) {
      blocks.push({
        kind: "h3",
        text: stripLeadingBlockMarker(line),
        lineStart: lineIndex,
        lineEnd: lineIndex,
      });
      lineIndex++;
    } else if (line.startsWith("## ")) {
      blocks.push({
        kind: "h2",
        text: stripLeadingBlockMarker(line),
        lineStart: lineIndex,
        lineEnd: lineIndex,
      });
      lineIndex++;
    } else if (line.startsWith("# ")) {
      blocks.push({
        kind: "h1",
        text: stripLeadingBlockMarker(line),
        lineStart: lineIndex,
        lineEnd: lineIndex,
      });
      lineIndex++;
    } else if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push({ kind: "hr", text: "", lineStart: lineIndex, lineEnd: lineIndex });
      lineIndex++;
    } else if (line.startsWith("> ")) {
      const start = lineIndex;
      const body: string[] = [];

      while (lineIndex < lines.length && lines[lineIndex]!.startsWith("> ")) {
        body.push(stripLeadingBlockMarker(lines[lineIndex]!));
        lineIndex++;
      }
      blocks.push({
        kind: "quote",
        text: body.join("\n"),
        lineStart: start,
        lineEnd: lineIndex - 1,
      });
    } else if (line.startsWith("- ")) {
      blocks.push({
        kind: "li",
        text: stripLeadingBlockMarker(line),
        lineStart: lineIndex,
        lineEnd: lineIndex,
      });
      lineIndex++;
    } else if (/^\d+\. /.test(line)) {
      blocks.push({
        kind: "oli",
        text: stripLeadingBlockMarker(line),
        lineStart: lineIndex,
        lineEnd: lineIndex,
      });
      lineIndex++;
    } else if (isTableStart(lines, lineIndex)) {
      const start = lineIndex;
      const body: string[] = [lines[lineIndex]!, lines[lineIndex + 1]!];

      lineIndex += 2;
      // body rows run until a blank line, a fence, or a line without a pipe
      while (
        lineIndex < lines.length &&
        lines[lineIndex]!.trim() !== "" &&
        lines[lineIndex]!.includes("|") &&
        !lines[lineIndex]!.startsWith("```")
      ) {
        body.push(lines[lineIndex]!);
        lineIndex++;
      }
      blocks.push({ kind: "table", text: body.join("\n"), lineStart: start, lineEnd: lineIndex - 1 });
    } else {
      const start = lineIndex;
      const body: string[] = [];

      while (
        lineIndex < lines.length &&
        lines[lineIndex]!.trim() !== "" &&
        !isMarkerLine(lines[lineIndex]!) &&
        !isTableStart(lines, lineIndex)
      ) {
        body.push(lines[lineIndex]!);
        lineIndex++;
      }
      blocks.push({ kind: "p", text: body.join("\n"), lineStart: start, lineEnd: lineIndex - 1 });
    }
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
