/**
 * The diff review sheet: the code surface where discussions live inline under
 * the lines they mark, exactly as the plan thread view does for prose. The caret,
 * click/drag marks, type-to-comment, the "/" palette, and the discussion cards
 * come from the shared annotation surface; this sheet paints the diff's own rows -
 * file bands, hunk headers, a line-number gutter with the change sign, syntax and
 * intra-line colors, curated-out lines struck through - one text per visual line
 * so a drag can hit-test any row, unified or side by side.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createTextAttributes, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core";
import type { Annotation, Thread } from "@cueloop/schema";
import { diffRowText, fileChangeCounts, type DiffRow, type Mark } from "../view-diff";
import type { TextSpan } from "../thread-selection";
import type { QuickAction } from "../config";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";
import { createIntralineResolver, type IntralineRun } from "../diff-intraline";
import { highlightDiffRows, type SyntaxSpan } from "../diff-syntax";
import { splitDiffRows, type SplitLine, type SplitRow } from "../split-diff";
import { UNDERLINE, type AnnotationPalette } from "../annotation-palette";
import { lineMarkRanges, runsFor, wrapLines, type MarkRange } from "../mark-runs";
import { useFrameMeasure } from "../use-frame-measure";
import { useTerminalVirtualizer } from "../use-terminal-virtualizer";
import { useAnnotationSurface, type LineSource } from "../use-annotation-surface";
import { DiscussionMarkerRail } from "./DiscussionMarkerRail";
import { coloredRowSpans } from "./diff-content-view-layout";

/** Shared empty map so an unresolved/stale highlight state is a stable value. */
const EMPTY_SYNTAX: Map<number, SyntaxSpan[]> = new Map();

/** Shared empty set so "nothing rejected" is a stable identity for renders. */
const EMPTY_REJECTED: Set<number> = new Set();

/** A rejected (curated-out) change row renders struck through and dimmed. */
const REJECTED_ATTRIBUTES = createTextAttributes({ strikethrough: true, dim: true });

/** A file band renders its name in bold between an equal rule above and below. */
const FILE_HEADER_ATTRIBUTES = createTextAttributes({ bold: true });

/** The split-view gutter before a code line: caret bar, four-digit line number, a space, the sign, a space. */
const GUTTER_COLUMNS = 8;

/** The stacked gutter around its two line-number columns: caret bar, the space between them, a space, the sign, a space. */
const UNIFIED_GUTTER_CHROME = 5;

/** The widest line number in the diff, so the stacked gutter's two columns stay as narrow as the file allows. */
function lineNumberWidth(rows: DiffRow[]): number {
  let width = 1;

  for (const row of rows) {
    if (row.oldLine !== undefined) width = Math.max(width, String(row.oldLine).length);
    if (row.newLine !== undefined) width = Math.max(width, String(row.newLine).length);
  }

  return width;
}

/** The per-file fold controls the file band renders; absent in read-only story renders. */
export interface DiffFoldControls {
  isCollapsed: (file: string) => boolean;
  isExpanded: (file: string) => boolean;
  canExpand: (file: string) => boolean;
  onToggleCollapse: (file: string) => void;
  onToggleExpand: (file: string) => void;
  onCopyPath: (file: string) => void;
}

export interface DiffContentViewProps {
  rows: DiffRow[];
  session: Thread;
  /** Annotations resolved onto rows (marksByRows), with char ranges and spans. */
  marks: Map<number, Mark[]>;
  quickActions: QuickAction[];
  observer: boolean;
  /** Whether comments can be drafted here; false for a non-diff thread's view-only live diff. */
  commentsEnabled?: boolean;
  /** A verdict is in: no draft may open; the app answers with its read-only status. */
  resolved?: boolean;
  /** True while a menu, dialog, or overlay owns the keyboard. */
  suspended?: boolean;
  /** Reports whether a composer is open, so session chords can yield to typing. */
  onComposingChange?: (composing: boolean) => void;
  /** An observer or a resolved review refused a draft; the app shows why. */
  onObserverBlocked?: (reason: "observer" | "resolved") => void;
  /** Reports the caret's row, so row-level primitives (reject, fold) act where the caret is. */
  onCursorChange?: (rowIndex: number) => void;
  /** The rail's focused card; the discussion holding it takes focus here. */
  focusedAnnotationId?: string;
  /** Reports the focused discussion's root comment, so the rail follows. */
  onFocusAnnotation?: (annotationId: string | undefined) => void;
  onAnnotate: (span: TextSpan, body: string) => void;
  onReply: (rootAnnotationId: string, body: string) => void;
  onUpdateAnnotation: (id: string, body: string) => void;
  /** The author's display name for a comment's hover tooltip. */
  resolveAuthorLabel?: (annotation: Annotation) => string | undefined;
  leaderCombos?: readonly string[];
  onLeaderCommand?: (key: KeyEvent) => void;
  onExit: () => void;
  /** Row indices the owner rejected during curation; drawn struck through. */
  rejectedRows?: Set<number>;
  /** File-band chevron/copy/unfold actions; when absent the band shows no controls. */
  fold?: DiffFoldControls;
  /** Per-file +/- counts from the base rows, so a collapsed file keeps its badge; else computed here. */
  fileStats?: ReadonlyMap<string, { additions: number; deletions: number }>;
  /** Render old|new side by side instead of one inline column; the App gates this on zoom. */
  split?: boolean;
  /** A plain-file view (all context rows): one line-number gutter, no +/- sign. */
  fileView?: boolean;
  theme?: Theme;
}

/** A row the caret can rest on and a comment can anchor to. */
function isCodeRow(row: DiffRow | undefined): boolean {
  return row?.kind === "ctx" || row?.kind === "add" || row?.kind === "del";
}

/** The green +N red -N badge pinned to the file band's right edge. */
function FileCountsBadge({
  stats,
  tokens,
  marginRight,
}: {
  stats: { additions: number; deletions: number };
  tokens: Theme;
  marginRight: number;
}): React.ReactNode {
  if (stats.additions === 0 && stats.deletions === 0) return null;

  return (
    <text style={{ flexShrink: 0, wrapMode: "none", marginRight }}>
      {stats.additions > 0 ? (
        <span fg={tokens.insertedForeground}>{`+${stats.additions}`}</span>
      ) : null}
      {stats.additions > 0 && stats.deletions > 0 ? <span> </span> : null}
      {stats.deletions > 0 ? (
        <span fg={tokens.deletedForeground}>{`-${stats.deletions}`}</span>
      ) : null}
    </text>
  );
}

/** The file band's expand-all-lines toggle: the word "expand" stays put, its color carries the state
 *  (active white when the file is expanded, inactive gray when collapsed to changes) so nothing shifts. */
function ExpandToggle({
  expanded,
  onToggle,
  tokens,
}: {
  expanded: boolean;
  onToggle: () => void;
  tokens: Theme;
}): React.ReactNode {
  return (
    <box onMouseUp={onToggle} style={{ alignSelf: "center" }}>
      <text fg={expanded ? tokens.text : tokens.textDim} style={{ wrapMode: "none" }}>
        expand
      </text>
    </box>
  );
}

/**
 * A file band: chevron, bold name, and the added/removed counts between an equal rule above and
 * below. `fold` absent (story renders) drops the controls.
 */
function FileBand({
  row,
  stats,
  fold,
  tokens,
}: {
  row: DiffRow;
  stats: { additions: number; deletions: number } | undefined;
  fold: DiffFoldControls | undefined;
  tokens: Theme;
}): React.ReactNode {
  const file = row.file;
  const collapsed = fold?.isCollapsed(file) ?? false;
  const expanded = fold?.isExpanded(file) ?? false;
  const canExpand = fold?.canExpand(file) ?? false;

  return (
    <box style={{ borderStyle: "single", border: ["top", "bottom"], borderColor: tokens.border }}>
      <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <box style={{ flexDirection: "row", flexShrink: 1, minWidth: 0 }}>
          {fold ? (
            <IconButton
              glyph={collapsed ? NERD.chevronRight : NERD.chevronDown}
              onPress={() => fold.onToggleCollapse(file)}
              tip={collapsed ? "Expand file" : "Collapse file"}
              marginRight={1}
            />
          ) : null}
          <text
            fg={tokens.text}
            attributes={FILE_HEADER_ATTRIBUTES}
            style={{ flexShrink: 1, minWidth: 0, wrapMode: "none" }}
          >
            {diffRowText(row)}
          </text>
        </box>
        <box style={{ flexDirection: "row", flexShrink: 0 }}>
          {stats ? (
            <FileCountsBadge stats={stats} tokens={tokens} marginRight={fold ? 1 : 0} />
          ) : null}
          {fold ? (
            <IconButton
              glyph={NERD.copy}
              onPress={() => fold.onCopyPath(file)}
              tip="Copy path"
              marginRight={canExpand ? 1 : 0}
            />
          ) : null}
          {fold && canExpand ? (
            <ExpandToggle
              expanded={expanded}
              onToggle={() => fold.onToggleExpand(file)}
              tokens={tokens}
            />
          ) : null}
        </box>
      </box>
    </box>
  );
}

/** One code row rendered: its visual line rows, and the cards that hang under them. */
interface CodeRowNodes {
  lines: React.ReactNode[];
  cards: React.ReactNode[];
}

/** One side of a split pair rendered: its column of lines with its cards under them, or filler. */
interface SplitSideNodes {
  node: React.ReactNode;
}

/**
 * One item of the sheet's vertical layout: a base row (unified) or a split row, with the
 * visual lines it occupies. Cards under a materialized row add to the real height; the
 * model only has to be right enough for spacers and the caret reveal.
 */
interface LayoutItem {
  /** Index into the unified rows, or into the split rows when side by side. */
  index: number;
  height: number;
}

interface SheetLayout {
  items: LayoutItem[];
  /** Visual-line offset of each item from the top of the content. */
  offsets: number[];
  total: number;
  /** The layout item that shows a given base row, for the caret reveal. */
  itemOfRow: number[];
}

/** Rows this many visual lines beyond the viewport stay materialized, so a scroll step never shows a gap. */
const OVERSCAN_LINES = 30;

/** A file band is three rows (rule, name, rule); a hunk header one. */
function headerHeight(row: DiffRow): number {
  return row.kind === "file" ? 3 : 1;
}

function codeRowHeight(row: DiffRow, textWidth: number): number {
  return wrapLines(diffRowText(row), textWidth).length;
}

function buildLayout(items: LayoutItem[], itemOfRow: number[]): SheetLayout {
  const offsets: number[] = [];
  let total = 0;

  for (const item of items) {
    offsets.push(total);
    total += item.height;
  }

  return { items, offsets, total, itemOfRow };
}

function unifiedLayout(rows: DiffRow[], textWidth: number): SheetLayout {
  const items = rows.map((row, index) => ({
    index,
    height: isCodeRow(row) ? codeRowHeight(row, textWidth) : headerHeight(row),
  }));

  return buildLayout(
    items,
    rows.map((_row, index) => index),
  );
}

function splitLayout(splitRows: SplitRow[], rows: DiffRow[], textWidth: number): SheetLayout {
  const itemOfRow: number[] = [];
  const items = splitRows.map((pair, index) => {
    if (pair.kind !== "pair") {
      const row = rows[pair.rowIndex ?? -1];

      if (pair.rowIndex !== undefined) itemOfRow[pair.rowIndex] = index;

      return { index, height: row ? headerHeight(row) : 1 };
    }
    const sideHeight = (line: SplitLine | undefined): number =>
      line ? codeRowHeight(line.row, textWidth) : 0;

    if (pair.left) itemOfRow[pair.left.rowIndex] = index;
    if (pair.right) itemOfRow[pair.right.rowIndex] = index;

    return { index, height: Math.max(1, sideHeight(pair.left), sideHeight(pair.right)) };
  });

  return buildLayout(items, itemOfRow);
}

/** One painted stretch of a code line: its text with foreground, backdrop, and attributes. */
interface CodeSpan {
  text: string;
  fg: string;
  bg: string | undefined;
  attributes: number;
}

/**
 * The spans of one visual line: per character, the syntax or intra-line color under
 * the mark treatment (backdrop + underline) or the caret cell, coalesced where equal.
 * A rejected row paints one dim struck-through run, so it reads as excluded regardless
 * of its colors; a mark still shows through it.
 */
function codeLineSpans(
  lineText: string,
  lineStart: number,
  lineRanges: MarkRange[],
  fgByColumn: string[],
  emphasisBgByColumn: Array<string | undefined>,
  rejected: boolean,
  tokens: Theme,
  palette: AnnotationPalette,
): CodeSpan[] {
  const spans: CodeSpan[] = [];
  let column = 0;

  for (const run of runsFor(lineText, lineRanges)) {
    // a caret or a comment mark owns the whole run's backdrop; otherwise the changed-word tint (if any)
    // shows per column and the row box paints the soft band behind the rest
    const runBackground = run.caretOnly
      ? palette.caretCell
      : run.marked
        ? palette.markBackdrop
        : undefined;
    const attributes = (run.marked ? UNDERLINE : 0) | (rejected ? REJECTED_ATTRIBUTES : 0);

    for (const character of run.text) {
      const fg = rejected ? tokens.textDim : (fgByColumn[lineStart + column] ?? tokens.textMuted);
      const bg = runBackground ?? emphasisBgByColumn[lineStart + column];
      const previous = spans[spans.length - 1];

      if (
        previous &&
        previous.fg === fg &&
        previous.bg === bg &&
        previous.attributes === attributes
      ) {
        previous.text += character;
      } else spans.push({ text: character, fg, bg, attributes });
      column++;
    }
  }

  return spans;
}

/** Per-column foreground of a row's text: intra-line change color over syntax over the base. */
function foregroundColumns(
  text: string,
  baseColor: string,
  intraline: IntralineRun[] | undefined,
  syntax: SyntaxSpan[] | undefined,
  tokens: Theme,
): string[] {
  const columns: string[] = [];

  for (const span of coloredRowSpans(text, intraline, syntax, baseColor, tokens)) {
    // one color per code unit, matching the column model that indexes text by .length
    columns.push(...Array.from({ length: span.text.length }, () => span.foreground));
  }

  return columns;
}

function rowSign(row: DiffRow): string {
  return row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
}

function rowBaseColor(row: DiffRow, tokens: Theme): string {
  return row.kind === "add"
    ? tokens.insertedForeground
    : row.kind === "del"
      ? tokens.deletedForeground
      : tokens.textMuted;
}

/** The soft band behind a whole added/removed row; context rows carry no band. */
function rowBackground(row: DiffRow, tokens: Theme): string | undefined {
  return row.kind === "add"
    ? tokens.insertedBackground
    : row.kind === "del"
      ? tokens.deletedBackground
      : undefined;
}

/** The stronger tint behind an add/del row's gutter chip and its intra-line changed words. */
function rowEmphasisBackground(row: DiffRow, tokens: Theme): string | undefined {
  return row.kind === "add"
    ? tokens.insertedEmphasisBackground
    : row.kind === "del"
      ? tokens.deletedEmphasisBackground
      : undefined;
}

/** Per-column emphasis backdrop: the changed words of a modified line, else none. */
function emphasisBackgroundColumns(
  text: string,
  intraline: IntralineRun[] | undefined,
  emphasisBackground: string | undefined,
): Array<string | undefined> {
  const columns: Array<string | undefined> = Array.from({ length: text.length }, () => undefined);

  if (!intraline || !emphasisBackground) return columns;
  let offset = 0;

  for (const run of intraline) {
    if (run.changed)
      for (let index = 0; index < run.text.length && offset + index < text.length; index++)
        columns[offset + index] = emphasisBackground;
    offset += run.text.length;
  }

  return columns;
}

/** Async tree-sitter highlights, discarded when they belong to superseded rows. */
function useSyntaxHighlights(rows: DiffRow[]): Map<number, SyntaxSpan[]> {
  const [highlighted, setHighlighted] = useState<{
    rows: DiffRow[];
    byRow: Map<number, SyntaxSpan[]>;
  }>({
    rows,
    byRow: EMPTY_SYNTAX,
  });

  useEffect(() => {
    let active = true;

    highlightDiffRows(rows).then(
      (byRow) => {
        if (active) setHighlighted({ rows, byRow });
      },
      (error) => {
        // a highlighter torn down mid-init rejects after unmount (active === false): expected, silent.
        // a rejection while still mounted is a real failure - surface it and leave the rows unhighlighted
        if (active) console.error("diff syntax highlighting failed", error);
      },
    );

    return () => {
      active = false;
    };
  }, [rows]);

  return highlighted.rows === rows ? highlighted.byRow : EMPTY_SYNTAX;
}

export function DiffContentView({
  rows,
  session,
  marks,
  quickActions,
  observer,
  commentsEnabled = true,
  resolved = false,
  suspended = false,
  onComposingChange,
  onObserverBlocked,
  onCursorChange,
  focusedAnnotationId,
  onFocusAnnotation,
  onAnnotate,
  onReply,
  onUpdateAnnotation,
  resolveAuthorLabel,
  leaderCombos,
  onLeaderCommand,
  onExit,
  rejectedRows = EMPTY_REJECTED,
  fold,
  fileStats: fileStatsProp,
  split = false,
  fileView = false,
  theme,
}: DiffContentViewProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const source: LineSource = {
    count: rows.length,
    textAt: (rowIndex) => diffRowText(rows[rowIndex]!),
    annotatable: (rowIndex) => isCodeRow(rows[rowIndex]),
  };
  const surface = useAnnotationSurface({
    source,
    session,
    marks,
    quickActions,
    tokens,
    observer,
    commentsEnabled,
    resolved,
    suspended,
    onComposingChange,
    onObserverBlocked,
    onCursorChange,
    focusedAnnotationId,
    onFocusAnnotation,
    onAnnotate,
    onReply,
    onUpdateAnnotation,
    resolveAuthorLabel,
    leaderCombos,
    onLeaderCommand,
    onExit,
  });
  const { palette } = surface;
  const numberWidth = useMemo(() => lineNumberWidth(rows), [rows]);
  const unifiedGutterColumns = numberWidth * 2 + UNIFIED_GUTTER_CHROME;
  const intralineResolver = useMemo(() => createIntralineResolver(rows), [rows]);
  const syntaxByRow = useSyntaxHighlights(rows);
  const splitRows = useMemo(() => (split ? splitDiffRows(rows) : []), [split, rows]);
  const localStats = useMemo(() => fileChangeCounts(rows), [rows]);
  // base-row counts survive a collapse (folded rows drop the file's add/del rows); fall back locally
  const fileStats = fileStatsProp ?? localStats;
  const viewWidth = useFrameMeasure(
    () => scrollRef.current?.content?.width ?? 0,
    (left, right) => left === right,
    0,
  );
  // a file view shows one number; split gives each column its own gutter; stacked shows old and new
  const textWidth = fileView
    ? Math.max(0, viewWidth - (numberWidth + 2))
    : split
      ? Math.max(0, Math.floor((viewWidth - 1) / 2) - GUTTER_COLUMNS)
      : Math.max(0, viewWidth - unifiedGutterColumns);

  // Every visual line is its own text renderable (so a drag can hit-test it), and a large
  // diff has tens of thousands of them - more native text buffers than the renderer can
  // hold. So the sheet is virtual: only the viewport plus an overscan is mounted, each row
  // estimated at its wrapped line count until its box (cards included) is measured.
  const layout = useMemo(
    () => (split ? splitLayout(splitRows, rows, textWidth) : unifiedLayout(rows, textWidth)),
    [split, splitRows, rows, textWidth],
  );
  const virtual = useTerminalVirtualizer({
    scrollbox: scrollRef,
    count: layout.items.length,
    estimateSize: (index) => layout.items[index]?.height ?? 1,
    overscan: OVERSCAN_LINES,
  });

  // an opening card shifts the layout, so the row it belongs to is revealed again; a
  // discussion focused from the rail is scrolled into view the same way
  const revealItem = layout.itemOfRow[surface.revealBlockIndex];

  useEffect(() => {
    if (revealItem !== undefined) virtual.scrollToIndex(revealItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface.revealBlockIndex]);

  /**
   * The visual lines of one code row painted with gutter, colors, and marks; cards collected after.
   * `paintMarks` false renders the line plain (no caret, no mark backdrop) - the split view uses it so
   * a context row, shared by both columns, only carries the caret and marks on the change side.
   */
  const codeRowLines = (
    row: DiffRow,
    rowIndex: number,
    textWidth: number,
    keyPrefix: string,
    paintMarks = true,
  ): CodeRowNodes => {
    const text = diffRowText(row);
    const lines = wrapLines(text, textWidth);
    const ranges = paintMarks ? surface.rangesFor(rowIndex) : [];
    const fgByColumn = foregroundColumns(
      text,
      rowBaseColor(row, tokens),
      intralineResolver.runsForRow(rowIndex),
      syntaxByRow.get(rowIndex),
      tokens,
    );
    const emphasisBgByColumn = emphasisBackgroundColumns(
      text,
      intralineResolver.runsForRow(rowIndex),
      rowEmphasisBackground(row, tokens),
    );
    const rowBg = rowBackground(row, tokens);
    const rejected = rejectedRows.has(rowIndex);
    const isCaretRow = paintMarks && surface.head.blockIndex === rowIndex;
    // split view carries one number per side; the stacked view shows the old and new numbers together
    const splitLineNumber = row.kind === "del" ? row.oldLine : row.newLine;
    const splitGutter = `${isCaretRow ? "▎" : " "}${String(splitLineNumber ?? "").padStart(4, " ")} ${rowSign(row)} `;
    const barChar = isCaretRow ? "▎" : " ";
    const barColor = isCaretRow ? tokens.accent : tokens.textDim;
    const oldNumber =
      row.kind === "add"
        ? " ".repeat(numberWidth)
        : String(row.oldLine ?? "").padStart(numberWidth);
    const newNumber =
      row.kind === "del"
        ? " ".repeat(numberWidth)
        : String(row.newLine ?? "").padStart(numberWidth);
    const gutterFor = (lineIndex: number): React.ReactNode => {
      if (fileView) {
        // a plain file has no old/new sides, so one line number reads like an ordinary file viewer
        return lineIndex === 0 ? (
          <>
            <span fg={barColor}>{barChar}</span>
            <span fg={tokens.textDim}>{String(row.newLine ?? "").padStart(numberWidth)}</span>
            <span> </span>
          </>
        ) : (
          " ".repeat(numberWidth + 2)
        );
      }
      if (split) {
        return lineIndex === 0 ? (
          <>
            <span fg={isCaretRow ? tokens.accent : tokens.textDim}>{splitGutter.slice(0, 6)}</span>
            <span fg={rowBaseColor(row, tokens)}>{splitGutter.slice(6)}</span>
          </>
        ) : (
          " ".repeat(GUTTER_COLUMNS)
        );
      }
      // stacked: caret bar, old new (each tinted red/green on its side), then the change sign;
      // the numbers sit on the row's soft band, only the changed code carries the brighter backdrop
      return lineIndex === 0 ? (
        <>
          <span fg={barColor}>{barChar}</span>
          <span fg={row.kind === "del" ? tokens.deletedForeground : tokens.textDim}>
            {oldNumber}
          </span>
          <span fg={tokens.textDim}> </span>
          <span fg={row.kind === "add" ? tokens.insertedForeground : tokens.textDim}>
            {newNumber}
          </span>
          <span> </span>
          <span fg={rowBaseColor(row, tokens)}>{`${rowSign(row)} `}</span>
        </>
      ) : (
        <>
          <span fg={barColor}>{barChar}</span>
          {" ".repeat(unifiedGutterColumns - 1)}
        </>
      );
    };
    const lineNodes: React.ReactNode[] = [];
    const cards: React.ReactNode[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;
      const isLastLine = lineIndex === lines.length - 1;

      lineNodes.push(
        <box
          key={`${keyPrefix}-line-${lineIndex}`}
          style={{ flexDirection: "row", backgroundColor: rowBg }}
        >
          <text
            selectable={false}
            fg={isCaretRow && lineIndex === 0 ? tokens.accent : tokens.textDim}
            style={{ flexShrink: 0, wrapMode: "none" }}
          >
            {gutterFor(lineIndex)}
          </text>
          <text
            selectable={false}
            style={{ flexGrow: 1, flexShrink: 1, wrapMode: "none" }}
            ref={surface.registerLine(rowIndex, lineIndex, line)}
            onMouseDown={surface.onLineMouseDown}
          >
            {codeLineSpans(
              text.slice(line.start, line.end),
              line.start,
              lineMarkRanges(ranges, line),
              fgByColumn,
              emphasisBgByColumn,
              rejected,
              tokens,
              palette,
            ).map((span, spanIndex) => (
              <span key={spanIndex} fg={span.fg} bg={span.bg} attributes={span.attributes}>
                {span.text}
              </span>
            ))}
          </text>
        </box>,
      );
      // cards render on the side that owns the row, so a shared context row's card is not duplicated
      if (paintMarks) cards.push(...surface.cardsAfterLine(rowIndex, line, isLastLine));
    }

    return { lines: lineNodes, cards };
  };

  const headerNode = (row: DiffRow, rowIndex: number): React.ReactNode =>
    row.kind === "file" ? (
      <box key={rowIndex} id={`diff-row-${rowIndex}`}>
        <FileBand row={row} stats={fileStats.get(row.file)} fold={fold} tokens={tokens} />
      </box>
    ) : (
      <text
        key={rowIndex}
        id={`diff-row-${rowIndex}`}
        fg={tokens.blue}
        style={{ wrapMode: "none" }}
      >
        {` ${diffRowText(row)}`}
      </text>
    );

  const unifiedItem = (rowIndex: number): React.ReactNode => {
    const row = rows[rowIndex]!;

    if (!isCodeRow(row)) return headerNode(row, rowIndex);
    const { lines, cards } = codeRowLines(row, rowIndex, textWidth, `row-${rowIndex}`);

    return (
      <box key={rowIndex} id={`diff-row-${rowIndex}`} style={{ flexDirection: "column" }}>
        {lines}
        {cards}
      </box>
    );
  };

  /** One side of a split pair: the row's visual lines, or blank filler that reads as absent. */
  const splitSide = (
    line: SplitLine | undefined,
    side: "left" | "right",
    textWidth: number,
    keyPrefix: string,
  ): SplitSideNodes => {
    if (!line) {
      const filler = (
        <box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, backgroundColor: tokens.panel }} />
      );

      return { node: filler };
    }
    // the change side (right: additions and context) owns the caret and marks; the left carries them
    // only on its deletions, so a context row shared by both columns is not marked twice
    const paintMarks = side === "right" || line.kind === "del";
    const { lines, cards } = codeRowLines(
      line.row,
      line.rowIndex,
      textWidth,
      keyPrefix,
      paintMarks,
    );
    // a discussion stays in the pane of the side it annotates, under that side's lines
    const column = (
      <box style={{ flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        {lines}
        {cards}
      </box>
    );

    return { node: column };
  };

  const splitItem = (pairIndex: number): React.ReactNode => {
    const pair: SplitRow = splitRows[pairIndex]!;

    if (pair.kind !== "pair") {
      const rowIndex = pair.rowIndex ?? -1;

      return headerNode(
        rows[rowIndex] ?? { kind: pair.kind, text: pair.file, file: pair.file },
        rowIndex,
      );
    }
    const left = splitSide(pair.left, "left", textWidth, `pair-${pairIndex}-left`);
    const right = splitSide(pair.right, "right", textWidth, `pair-${pairIndex}-right`);
    // both sides answer to the pair's id, so a reveal of either base row lands here
    const anchorRow = pair.right?.rowIndex ?? pair.left?.rowIndex ?? -1;
    const otherRow = pair.left?.rowIndex;

    return (
      <box
        key={`pair-${pairIndex}`}
        id={`diff-row-${anchorRow}`}
        style={{ flexDirection: "column" }}
      >
        {/* stretch so the divider box grows to the taller side's wrapped height, leaving no gap */}
        <box
          id={otherRow !== undefined && otherRow !== anchorRow ? `diff-row-${otherRow}` : undefined}
          style={{ flexDirection: "row", alignItems: "stretch" }}
        >
          {left.node}
          <box
            style={{
              flexShrink: 0,
              borderStyle: "single",
              border: ["left"],
              borderColor: tokens.border,
            }}
          />
          {right.node}
        </box>
      </box>
    );
  };

  const materialized: React.ReactNode[] = [];
  const firstItem = virtual.items[0];
  const lastItem = virtual.items[virtual.items.length - 1];

  if (firstItem && lastItem) {
    const below = virtual.totalSize - lastItem.end;

    if (firstItem.start > 0) {
      materialized.push(<box key="spacer-above" style={{ height: firstItem.start }} />);
    }
    for (const item of virtual.items) {
      // the wrapper is what gets measured, so a row's cards count toward its height
      materialized.push(
        <box key={`item-${item.index}`} ref={virtual.measureRef(item.index)}>
          {split ? splitItem(item.index) : unifiedItem(item.index)}
        </box>,
      );
    }
    if (below > 0) materialized.push(<box key="spacer-below" style={{ height: below }} />);
  }

  return (
    <box style={{ flexGrow: 1, flexDirection: "row" }} {...surface.rootMouseProps}>
      <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingTop: 0 }}>
        {/* the rail draws this box's scrollbar past the dots, so the built-in one stays hidden */}
        <scrollbox
          id="diff-scroll"
          ref={scrollRef}
          style={{ flexGrow: 1 }}
          focused={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          {materialized}
        </scrollbox>
      </box>
      <DiscussionMarkerRail
        discussions={surface.discussions}
        spanQuote={surface.spanQuote}
        onJump={surface.jumpToDiscussion}
        scrollbox={scrollRef}
        theme={theme}
      />
    </box>
  );
}
