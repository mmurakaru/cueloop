/**
 * Markdown block model: parse source into addressable blocks that record
 * their source line ranges. Rendered-to-source mapping is block+line
 * granular; the quote carries sub-block precision. Round-trip safe for the
 * subset cueloop plans use; unknown constructs fall back to paragraph blocks
 * so no content is ever lost.
 */

export type BlockKind = "h1" | "h2" | "h3" | "p" | "li" | "oli" | "quote" | "code" | "hr";

export interface Block {
  kind: BlockKind;
  /** Content with markers stripped; code blocks keep inner lines verbatim. */
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
    } else {
      const start = lineIndex;
      const body: string[] = [];

      while (
        lineIndex < lines.length &&
        lines[lineIndex]!.trim() !== "" &&
        !isMarkerLine(lines[lineIndex]!)
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
