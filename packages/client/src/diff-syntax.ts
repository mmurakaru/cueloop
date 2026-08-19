/**
 * Syntax highlighting for diff rows: tree-sitter token colors mapped onto the
 * diff sheet's hand-rolled rows, so annotation cards still interleave. A hunk is
 * highlighted as a contiguous fragment (its context+addition lines as the new
 * side, context+deletion lines as the old side) - never per single line, which
 * would lose the multi-line grammar context - and the resulting token spans are
 * mapped back to each row in line-relative columns. Async: the shared tree-sitter
 * client resolves off the render path, so callers draw unstyled first.
 */

import { getTreeSitterClient, type SimpleHighlight } from "@opentui/core";
import type { DiffRow } from "./view-diff";
import { filetypeForPath } from "./components/syntax-highlight";

/** A syntax-colored run within one row, in line-relative columns [start, end). */
export interface SyntaxSpan {
  start: number;
  end: number;
  group: string;
}

function stripTrailingNewline(text: string): string {
  return text.replace(/\n$/, "");
}

interface HighlightJob {
  filetype: string;
  source: string;
  /** Row index for each line of `source`, in order. */
  rowIndexByLine: number[];
}

/**
 * Split diff rows into per-hunk highlight jobs, one per side. A hunk's rows are
 * contiguous file lines, so each side reconstructs to valid code; file/hunk
 * header rows and files without a known filetype are skipped.
 */
export function highlightJobs(rows: DiffRow[]): HighlightJob[] {
  const jobs: HighlightJob[] = [];
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let oldRowIndexByLine: number[] = [];
  let newRowIndexByLine: number[] = [];
  let filetype: string | undefined;

  const flush = (): void => {
    if (filetype) {
      if (oldLines.length)
        jobs.push({ filetype, source: oldLines.join("\n"), rowIndexByLine: oldRowIndexByLine });
      if (newLines.length)
        jobs.push({ filetype, source: newLines.join("\n"), rowIndexByLine: newRowIndexByLine });
    }
    oldLines = [];
    newLines = [];
    oldRowIndexByLine = [];
    newRowIndexByLine = [];
  };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    if (row.kind === "file" || row.kind === "hunk") {
      flush();
      filetype = row.kind === "file" ? filetypeForPath(row.file) : filetype;
      continue;
    }
    const text = stripTrailingNewline(row.text);
    if (row.kind === "ctx" || row.kind === "del") {
      oldLines.push(text);
      oldRowIndexByLine.push(rowIndex);
    }
    if (row.kind === "ctx" || row.kind === "add") {
      newLines.push(text);
      newRowIndexByLine.push(rowIndex);
    }
  }
  flush();
  return jobs;
}

/**
 * Resolve one source's flat, possibly-overlapping token highlights into
 * per-line spans. Offsets are absolute into `source`; later highlights win on
 * overlap, and a highlight is clamped to the line its start falls on.
 */
export function spansByLine(source: string, highlights: SimpleHighlight[]): SyntaxSpan[][] {
  const lineStarts: number[] = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }
  const lineOf = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  // Per-line char->group, later highlights overriding, then coalesce into spans.
  const groupsByLine: Array<Array<string | undefined>> = lineStarts.map((start, line) => {
    const end = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : source.length;
    return Array.from({ length: Math.max(0, end - start) }, () => undefined);
  });
  for (const [start, end, group] of highlights) {
    const line = lineOf(start);
    const lineStart = lineStarts[line]!;
    const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1]! - 1 : source.length;
    const from = start - lineStart;
    const to = Math.min(end, lineEnd) - lineStart;
    const chars = groupsByLine[line]!;
    for (let column = from; column < to; column++) chars[column] = group;
  }
  return groupsByLine.map((chars) => {
    const spans: SyntaxSpan[] = [];
    for (let column = 0; column < chars.length; column++) {
      const group = chars[column];
      if (group === undefined) continue;
      const previous = spans[spans.length - 1];
      if (previous && previous.group === group && previous.end === column)
        previous.end = column + 1;
      else spans.push({ start: column, end: column + 1, group });
    }
    return spans;
  });
}

/**
 * Highlight the diff's rows and return the token spans per row index. Rows in a
 * file with no known filetype, and any row while highlighting is still resolving,
 * are absent - the caller renders those unstyled.
 */
export async function highlightDiffRows(rows: DiffRow[]): Promise<Map<number, SyntaxSpan[]>> {
  const spansByRow = new Map<number, SyntaxSpan[]>();
  const jobs = highlightJobs(rows);
  if (!jobs.length) return spansByRow;
  const client = getTreeSitterClient();
  await client.initialize();
  for (const job of jobs) {
    const result = await client.highlightOnce(job.source, job.filetype);
    if (!result.highlights) continue;
    const lineSpans = spansByLine(job.source, result.highlights);
    job.rowIndexByLine.forEach((rowIndex, line) => {
      const spans = lineSpans[line];
      if (spans && spans.length) spansByRow.set(rowIndex, spans);
    });
  }
  return spansByRow;
}
