/**
 * Per-file fold state for the diff sheet, applied over the flat diff rows so the
 * cursor, curation, and rendering all read one array. A collapsed file shows only
 * its file band; an expanded file shows its whole contents with the diff woven in
 * (unchanged lines become context rows), matching VSCode's "expand all lines".
 */

import type { DiffRow } from "./view-diff";

/** The full old/new contents a diff carries per file (curatable diffs do). */
export interface FileContents {
  path: string;
  newContents: string;
  oldContents: string;
}

/** Split file contents into lines, dropping the single trailing newline the file carries. */
function contentLines(contents: string): string[] {
  if (contents === "") return [];

  return contents.replace(/\n$/, "").split("\n");
}

/**
 * Weave a file's hunk rows into its full contents: unchanged lines between and
 * around the hunks become context rows, so the whole file renders with the diff
 * inline. `codeRows` are the file's ctx/add/del rows in order (no headers).
 */
export function weaveFullFileRows(
  fileName: string,
  codeRows: DiffRow[],
  newContents: string,
): DiffRow[] {
  const newLines = contentLines(newContents);
  const woven: DiffRow[] = [];
  // the next unchanged old/new line numbers to emit while filling gaps between hunks
  let newCursor = 1;
  let oldCursor = 1;
  const fillTo = (newLine: number): void => {
    while (newCursor < newLine) {
      woven.push({
        kind: "ctx",
        text: newLines[newCursor - 1] ?? "",
        file: fileName,
        oldLine: oldCursor,
        newLine: newCursor,
      });
      newCursor += 1;
      oldCursor += 1;
    }
  };

  for (const row of codeRows) {
    if (row.newLine !== undefined) {
      fillTo(row.newLine);
      woven.push(row);
      newCursor = row.newLine + 1;
      if (row.kind === "ctx") oldCursor = (row.oldLine ?? oldCursor) + 1;
    } else {
      // a deletion consumes an old line only; it keeps its place before the additions
      woven.push(row);
      oldCursor = (row.oldLine ?? oldCursor) + 1;
    }
  }
  // the unchanged tail after the last hunk
  while (newCursor <= newLines.length) {
    woven.push({
      kind: "ctx",
      text: newLines[newCursor - 1] ?? "",
      file: fileName,
      oldLine: oldCursor,
      newLine: newCursor,
    });
    newCursor += 1;
    oldCursor += 1;
  }

  return woven;
}

/**
 * Rebuild the diff rows with per-file fold state. A collapsed file keeps only its
 * file band; an expanded file with known contents shows its whole file woven; every
 * other file keeps its hunks. Row order and the file bands themselves are preserved.
 */
export function applyFold(
  base: DiffRow[],
  collapsed: ReadonlySet<string>,
  expanded: ReadonlySet<string>,
  files: readonly FileContents[] | undefined,
): DiffRow[] {
  if (collapsed.size === 0 && expanded.size === 0) return base;
  const contentsByPath = new Map((files ?? []).map((file) => [file.path, file]));
  const out: DiffRow[] = [];
  let index = 0;

  while (index < base.length) {
    const row = base[index]!;

    if (row.kind !== "file") {
      out.push(row);
      index += 1;
      continue;
    }
    out.push(row);
    const file = row.file;
    let end = index + 1;

    while (end < base.length && base[end]!.kind !== "file") end += 1;
    const body = base.slice(index + 1, end);
    const contents = contentsByPath.get(file);

    if (collapsed.has(file)) {
      // only the file band; the body is hidden
    } else if (expanded.has(file) && contents) {
      const codeRows = body.filter((bodyRow) => bodyRow.kind !== "hunk");

      out.push(...weaveFullFileRows(file, codeRows, contents.newContents));
    } else {
      out.push(...body);
    }
    index = end;
  }

  return out;
}
