/** Tree-sitter colors for fenced code blocks in a Thread, in rendered-text offsets. */

import { getTreeSitterClient } from "@opentui/core";
import type { DisplayBlock } from "./view-plan";
import { renderedText } from "./view-plan";
import { spansByLine, type SyntaxSpan } from "./diff-syntax";
import { filetypeFor } from "./components/syntax-highlight";

export type { SyntaxSpan } from "./diff-syntax";

/** Highlight whole code blocks so multi-line syntax stays intact. */
export async function highlightThreadCodeBlocks(
  display: DisplayBlock[],
): Promise<Map<number, SyntaxSpan[]>> {
  const jobs = display.flatMap((block, blockIndex) => {
    if (block.kind !== "code") return [];
    const filetype = filetypeFor(block.work?.lang ?? block.base?.lang);

    return filetype ? [{ blockIndex, filetype, source: renderedText(block) }] : [];
  });
  const byBlock = new Map<number, SyntaxSpan[]>();

  if (jobs.length === 0) return byBlock;
  const client = getTreeSitterClient();

  await client.initialize();
  for (const job of jobs) {
    const result = await client.highlightOnce(job.source, job.filetype);

    if (!result.highlights) continue;
    const spans: SyntaxSpan[] = [];
    let offset = 0;
    const lines = job.source.split("\n");

    spansByLine(job.source, result.highlights).forEach((lineSpans, lineIndex) => {
      for (const span of lineSpans) {
        spans.push({ start: offset + span.start, end: offset + span.end, group: span.group });
      }
      offset += lines[lineIndex]!.length + 1;
    });
    byBlock.set(job.blockIndex, spans);
  }

  return byBlock;
}
