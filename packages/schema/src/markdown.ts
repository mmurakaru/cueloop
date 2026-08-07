/**
 * Markdown block model (map #22): parse source into addressable blocks that
 * record their source line ranges. Rendered→source mapping is block+line
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

function isMarkerLine(l: string): boolean {
  return (
    l.startsWith("```") ||
    l.startsWith("# ") ||
    l.startsWith("## ") ||
    l.startsWith("### ") ||
    l.startsWith("> ") ||
    /^- /.test(l) ||
    /^\d+\. /.test(l) ||
    /^(---|\*\*\*|___)\s*$/.test(l)
  );
}

export function parseBlocks(md: string): Block[] {
  const lines = md.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.trim() === "") {
      i++;
      continue;
    }
    if (l.startsWith("```")) {
      const start = i;
      const lang = l.slice(3).trim() || undefined;
      i++;
      const body: string[] = [];
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        body.push(lines[i]!);
        i++;
      }
      const end = Math.min(i, lines.length - 1);
      i++;
      blocks.push({ kind: "code", text: body.join("\n"), lang, lineStart: start, lineEnd: end });
    } else if (l.startsWith("### ")) {
      blocks.push({ kind: "h3", text: l.slice(4), lineStart: i, lineEnd: i });
      i++;
    } else if (l.startsWith("## ")) {
      blocks.push({ kind: "h2", text: l.slice(3), lineStart: i, lineEnd: i });
      i++;
    } else if (l.startsWith("# ")) {
      blocks.push({ kind: "h1", text: l.slice(2), lineStart: i, lineEnd: i });
      i++;
    } else if (/^(---|\*\*\*|___)\s*$/.test(l)) {
      blocks.push({ kind: "hr", text: "", lineStart: i, lineEnd: i });
      i++;
    } else if (l.startsWith("> ")) {
      const start = i;
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) {
        body.push(lines[i]!.slice(2));
        i++;
      }
      blocks.push({ kind: "quote", text: body.join("\n"), lineStart: start, lineEnd: i - 1 });
    } else if (/^- /.test(l)) {
      blocks.push({ kind: "li", text: l.slice(2), lineStart: i, lineEnd: i });
      i++;
    } else if (/^\d+\. /.test(l)) {
      blocks.push({ kind: "oli", text: l.replace(/^\d+\. /, ""), lineStart: i, lineEnd: i });
      i++;
    } else {
      const start = i;
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== "" && !isMarkerLine(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      blocks.push({ kind: "p", text: body.join("\n"), lineStart: start, lineEnd: i - 1 });
    }
  }
  return blocks;
}

/** Serialize one block back to its markdown chunk. */
export function blockToMd(b: Block, ordinal = 1): string {
  switch (b.kind) {
    case "h1":
      return "# " + b.text;
    case "h2":
      return "## " + b.text;
    case "h3":
      return "### " + b.text;
    case "li":
      return "- " + b.text;
    case "oli":
      return `${ordinal}. ` + b.text;
    case "quote":
      return b.text
        .split("\n")
        .map((l) => "> " + l)
        .join("\n");
    case "code":
      return "```" + (b.lang ?? "") + "\n" + b.text + "\n```";
    case "hr":
      return "---";
    default:
      return b.text;
  }
}

/** The section (nearest preceding heading) a block belongs to. */
export function sectionOf(blocks: Block[], index: number): string {
  let sec = "";
  for (let i = 0; i <= index && i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.kind === "h1" || b.kind === "h2" || b.kind === "h3") sec = b.text;
  }
  return sec;
}
