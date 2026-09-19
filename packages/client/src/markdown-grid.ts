/**
 * Grid layout for the two block kinds the read-only thread renders as tables:
 * a GFM table (bold header over a rule, columns aligned per the delimiter row,
 * no vertical borders - mirroring the VS Code preview) and leading YAML
 * frontmatter (a full-bordered key/value grid, bold nowrap keys, wrapped
 * values). Both are pure: they turn a block's source text and a width into
 * positioned, styled segments the renderer prints verbatim, so a char-frame
 * test can assert the exact grid.
 */

import { wrapLines } from "./mark-runs";

/** One painted piece of a grid line: its text plus whether it reads bold or dim (a border). */
export interface GridSegment {
  text: string;
  bold: boolean;
  dim: boolean;
}

/** A grid line is left-to-right segments; concatenating their text gives the row. */
export type GridLine = GridSegment[];

export type ColumnAlign = "left" | "right" | "center";

export interface MarkdownTable {
  aligns: ColumnAlign[];
  header: string[];
  rows: string[][];
}

/** Split a table row into trimmed cells, dropping one optional leading and trailing pipe. */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Parse a GFM table block's verbatim source into header cells, column alignments, and body rows. */
export function parseMarkdownTable(text: string): MarkdownTable {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const header = splitTableRow(lines[0] ?? "");
  const aligns: ColumnAlign[] = splitTableRow(lines[1] ?? "").map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");

    return left && right ? "center" : right ? "right" : "left";
  });
  const rows = lines.slice(2).map(splitTableRow);

  return { aligns, header, rows };
}

/** Pad `text` to `width` cells under an alignment. */
function pad(text: string, width: number, align: ColumnAlign): string {
  const slack = Math.max(0, width - text.length);

  if (align === "right") return " ".repeat(slack) + text;
  if (align === "center") {
    const left = Math.floor(slack / 2);

    return " ".repeat(left) + text + " ".repeat(slack - left);
  }

  return text + " ".repeat(slack);
}

/** Two spaces separate table columns; VS Code's preview draws no vertical rule. */
const COLUMN_GAP = "  ";

/**
 * Lay out a GFM table: a bold header row, a dim rule spanning the table width,
 * then the body rows, every column padded to its widest cell under its alignment.
 */
export function layoutMarkdownTable(table: MarkdownTable): GridLine[] {
  const columnCount = Math.max(table.header.length, ...table.rows.map((row) => row.length), 1);
  const alignOf = (column: number): ColumnAlign => table.aligns[column] ?? "left";
  const cellAt = (cells: string[], column: number): string => cells[column] ?? "";
  const widths = Array.from({ length: columnCount }, (_unused, column) =>
    Math.max(
      cellAt(table.header, column).length,
      ...table.rows.map((row) => cellAt(row, column).length),
      1,
    ),
  );
  const rowText = (cells: string[]): string =>
    widths
      .map((width, column) => pad(cellAt(cells, column), width, alignOf(column)))
      .join(COLUMN_GAP);
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) + COLUMN_GAP.length * (columnCount - 1);
  const lines: GridLine[] = [
    [{ text: rowText(table.header), bold: true, dim: false }],
    [{ text: "─".repeat(totalWidth), bold: false, dim: true }],
  ];

  for (const row of table.rows) lines.push([{ text: rowText(row), bold: false, dim: false }]);

  return lines;
}

export interface FrontmatterRow {
  key: string;
  value: string;
}

/** Parse frontmatter YAML into top-level key/value rows; indented lines fold into the row above. */
export function parseFrontmatterRows(text: string): FrontmatterRow[] {
  const rows: FrontmatterRow[] = [];

  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const match = /^([^:\s][^:]*):\s?(.*)$/.exec(line);

    if (match) {
      rows.push({ key: match[1]!.trim(), value: match[2]! });
    } else if (rows.length > 0) {
      const previous = rows[rows.length - 1]!;

      previous.value = previous.value === "" ? line.trim() : `${previous.value}\n${line.trim()}`;
    }
  }

  return rows;
}

/** The fixed cells a frontmatter grid row spends on borders and padding: `│ key │ value │`. */
const FRONTMATTER_CHROME = 7;

/** Wrap a cell value into lines no wider than `width`, honouring its own line breaks. */
function wrapCell(value: string, width: number): string[] {
  if (value === "") return [""];

  return wrapLines(value, width).map((line) => value.slice(line.start, line.end));
}

/**
 * Lay out leading frontmatter as a full-bordered key/value grid: bold nowrap
 * keys on the left, values wrapped to the remaining width on the right, a rule
 * between every row - the VS Code preview's frontmatter table.
 */
export function layoutFrontmatterGrid(rows: FrontmatterRow[], maxWidth: number): GridLine[] {
  if (rows.length === 0) return [];
  const keyWidth = Math.max(3, ...rows.map((row) => row.key.length));
  // size the value column to its content, capped at the width left after the key column and borders,
  // so a short frontmatter table stays compact and a long value wraps instead of overflowing
  const available = Math.max(3, maxWidth - keyWidth - FRONTMATTER_CHROME);
  const naturalWidth = Math.max(
    3,
    ...rows.map((row) => Math.max(0, ...row.value.split("\n").map((line) => line.length))),
  );
  const valueWidth = Math.min(naturalWidth, available);
  const rule = (left: string, mid: string, right: string): GridLine => [
    {
      text: left + "─".repeat(keyWidth + 2) + mid + "─".repeat(valueWidth + 2) + right,
      bold: false,
      dim: true,
    },
  ];
  const lines: GridLine[] = [rule("┌", "┬", "┐")];

  rows.forEach((row, rowIndex) => {
    if (rowIndex > 0) lines.push(rule("├", "┼", "┤"));
    const valueLines = wrapCell(row.value, valueWidth);

    valueLines.forEach((valueLine, valueIndex) => {
      const keyCell = valueIndex === 0 ? row.key.padEnd(keyWidth) : " ".repeat(keyWidth);

      lines.push([
        { text: "│ ", bold: false, dim: true },
        { text: keyCell, bold: valueIndex === 0, dim: false },
        { text: " │ ", bold: false, dim: true },
        { text: valueLine.padEnd(valueWidth), bold: false, dim: false },
        { text: " │", bold: false, dim: true },
      ]);
    });
  });
  lines.push(rule("└", "┴", "┘"));

  return lines;
}
