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
import { createTextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import type { ReviewSession } from "@cueloop/schema";
import { diffRowText, fileChangeCounts, type DiffRow } from "../view-diff";
import type { Mark } from "../view-plan";
import type { TextSpan } from "../thread-selection";
import type { QuickAction } from "../config";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { IconButton } from "./primitives/IconButton";
import { NERD } from "./primitives/icons";
import { intralineRunsByRow, type IntralineRun } from "../diff-intraline";
import { highlightDiffRows, type SyntaxSpan } from "../diff-syntax";
import { splitDiffRows, type SplitLine, type SplitRow } from "../split-diff";
import { UNDERLINE, type AnnotationPalette } from "../annotation-palette";
import { lineMarkRanges, runsFor, wrapLines, type MarkRange } from "../mark-runs";
import { useFrameMeasure } from "../use-frame-measure";
import { useAnnotationSurface, type LineSource } from "../use-annotation-surface";
import { coloredRowSpans } from "./diff-sheet-layout";

/** Shared empty map so an unresolved/stale highlight state is a stable value. */
const EMPTY_SYNTAX: Map<number, SyntaxSpan[]> = new Map();

/** Shared empty set so "nothing rejected" is a stable identity for renders. */
const EMPTY_REJECTED: Set<number> = new Set();

/** A rejected (curated-out) change row renders struck through and dimmed. */
const REJECTED_ATTRIBUTES = createTextAttributes({ strikethrough: true, dim: true });

/** A file band renders its name in bold between an equal rule above and below. */
const FILE_HEADER_ATTRIBUTES = createTextAttributes({ bold: true });

/** The gutter before a code line: caret bar, four-digit line number, a space, the sign, a space. */
const GUTTER_COLUMNS = 8;

/** The per-file fold controls the file band renders; absent in read-only story renders. */
export interface DiffFoldControls {
  isCollapsed: (file: string) => boolean;
  isExpanded: (file: string) => boolean;
  canExpand: (file: string) => boolean;
  onToggleCollapse: (file: string) => void;
  onToggleExpand: (file: string) => void;
  onCopyPath: (file: string) => void;
}

export interface DiffSheetProps {
  rows: DiffRow[];
  session: ReviewSession;
  /** Annotations resolved onto rows (marksByRows), with char ranges and spans. */
  marks: Map<number, Mark[]>;
  quickActions: QuickAction[];
  observer: boolean;
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
  onExit: () => void;
  /** Row indices the owner rejected during curation; drawn struck through. */
  rejectedRows?: Set<number>;
  /** File-band chevron/copy/unfold actions; when absent the band shows no controls. */
  fold?: DiffFoldControls;
  /** Per-file +/- counts from the base rows, so a collapsed file keeps its badge; else computed here. */
  fileStats?: ReadonlyMap<string, { additions: number; deletions: number }>;
  /** Render old|new side by side instead of one inline column; the App gates this on zoom. */
  split?: boolean;
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
            <IconButton
              glyph={NERD.unfold}
              onPress={() => fold.onToggleExpand(file)}
              tip={expanded ? "Collapse to changes" : "Expand all lines"}
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

/** One side of a split pair rendered: its column of lines (or filler) and the cards under it. */
interface SplitSideNodes {
  node: React.ReactNode;
  cards: React.ReactNode[];
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
  rejected: boolean,
  tokens: Theme,
  palette: AnnotationPalette,
): CodeSpan[] {
  const spans: CodeSpan[] = [];
  let column = 0;

  for (const run of runsFor(lineText, lineRanges)) {
    const bg = run.caretOnly ? palette.caretCell : run.marked ? palette.markBackdrop : undefined;
    const attributes = (run.marked ? UNDERLINE : 0) | (rejected ? REJECTED_ATTRIBUTES : 0);

    for (const character of run.text) {
      const fg = rejected ? tokens.textDim : (fgByColumn[lineStart + column] ?? tokens.textMuted);
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
    for (let index = 0; index < span.text.length; index++) columns.push(span.foreground);
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

    void highlightDiffRows(rows).then((byRow) => {
      if (active) setHighlighted({ rows, byRow });
    });

    return () => {
      active = false;
    };
  }, [rows]);

  return highlighted.rows === rows ? highlighted.byRow : EMPTY_SYNTAX;
}

export function DiffSheet({
  rows,
  session,
  marks,
  quickActions,
  observer,
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
  onExit,
  rejectedRows = EMPTY_REJECTED,
  fold,
  fileStats: fileStatsProp,
  split = false,
  theme,
}: DiffSheetProps): React.ReactNode {
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
    onExit,
  });
  const { palette } = surface;
  const intralineByRow = useMemo(() => intralineRunsByRow(rows), [rows]);
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

  // an opening card shifts the layout, so the row it belongs to is revealed again; a
  // discussion focused from the rail is scrolled into view the same way
  useEffect(() => {
    try {
      scrollRef.current?.scrollChildIntoView(`diff-row-${surface.revealBlockIndex}`);
    } catch {
      // best-effort reveal
    }
  }, [surface.revealBlockIndex]);

  /** The visual lines of one code row painted with gutter, colors, and marks; cards collected after. */
  const codeRowLines = (
    row: DiffRow,
    rowIndex: number,
    textWidth: number,
    keyPrefix: string,
  ): CodeRowNodes => {
    const text = diffRowText(row);
    const lines = wrapLines(text, textWidth);
    const ranges = surface.rangesFor(rowIndex);
    const fgByColumn = foregroundColumns(
      text,
      rowBaseColor(row, tokens),
      intralineByRow.get(rowIndex),
      syntaxByRow.get(rowIndex),
      tokens,
    );
    const rejected = rejectedRows.has(rowIndex);
    const isCaretRow = surface.head.blockIndex === rowIndex;
    const lineNumber = row.kind === "del" ? row.oldLine : row.newLine;
    const gutter = `${isCaretRow ? "▎" : " "}${String(lineNumber ?? "").padStart(4, " ")} ${rowSign(row)} `;
    const lineNodes: React.ReactNode[] = [];
    const cards: React.ReactNode[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;
      const isLastLine = lineIndex === lines.length - 1;

      lineNodes.push(
        <box key={`${keyPrefix}-line-${lineIndex}`} style={{ flexDirection: "row" }}>
          <text
            selectable={false}
            fg={isCaretRow && lineIndex === 0 ? tokens.accent : tokens.textDim}
            style={{ flexShrink: 0, wrapMode: "none" }}
          >
            {lineIndex === 0 ? (
              <>
                <span fg={isCaretRow ? tokens.accent : tokens.textDim}>{gutter.slice(0, 6)}</span>
                <span fg={rowBaseColor(row, tokens)}>{gutter.slice(6)}</span>
              </>
            ) : (
              " ".repeat(GUTTER_COLUMNS)
            )}
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
      cards.push(...surface.cardsAfterLine(rowIndex, line, isLastLine));
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

  const unifiedBody = (): React.ReactNode[] => {
    const textWidth = Math.max(0, viewWidth - GUTTER_COLUMNS);

    return rows.map((row, rowIndex) => {
      if (!isCodeRow(row)) return headerNode(row, rowIndex);
      const { lines, cards } = codeRowLines(row, rowIndex, textWidth, `row-${rowIndex}`);

      return (
        <box key={rowIndex} id={`diff-row-${rowIndex}`} style={{ flexDirection: "column" }}>
          {lines}
          {cards}
        </box>
      );
    });
  };

  /** One side of a split pair: the row's visual lines, or blank filler that reads as absent. */
  const splitSide = (
    line: SplitLine | undefined,
    textWidth: number,
    keyPrefix: string,
  ): SplitSideNodes => {
    if (!line) {
      const filler = (
        <box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, backgroundColor: tokens.panel }} />
      );

      return { node: filler, cards: [] };
    }
    const { lines, cards } = codeRowLines(line.row, line.rowIndex, textWidth, keyPrefix);
    const column = (
      <box style={{ flexDirection: "column", flexGrow: 1, flexBasis: 0, minWidth: 0 }}>{lines}</box>
    );

    return { node: column, cards };
  };

  const splitBody = (): React.ReactNode[] => {
    // two columns and a one-cell divider share the width; each column keeps its own gutter
    const textWidth = Math.max(0, Math.floor((viewWidth - 1) / 2) - GUTTER_COLUMNS);

    return splitRows.map((pair: SplitRow, pairIndex) => {
      if (pair.kind !== "pair") {
        const rowIndex = pair.rowIndex ?? -1;

        return headerNode(
          rows[rowIndex] ?? { kind: pair.kind, text: pair.file, file: pair.file },
          rowIndex,
        );
      }
      const left = splitSide(pair.left, textWidth, `pair-${pairIndex}-left`);
      const right = splitSide(pair.right, textWidth, `pair-${pairIndex}-right`);
      const anchorRow = pair.right?.rowIndex ?? pair.left?.rowIndex ?? -1;

      return (
        <box
          key={`pair-${pairIndex}`}
          id={`diff-row-${anchorRow}`}
          style={{ flexDirection: "column" }}
        >
          {/* stretch so the divider box grows to the taller side's wrapped height, leaving no gap */}
          <box style={{ flexDirection: "row", alignItems: "stretch" }}>
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
          {left.cards}
          {right.cards}
        </box>
      );
    });
  };

  return (
    <box
      style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingTop: 0 }}
      {...surface.rootMouseProps}
    >
      <scrollbox id="diff-scroll" ref={scrollRef} style={{ flexGrow: 1 }} focused={false}>
        {split ? splitBody() : unifiedBody()}
      </scrollbox>
    </box>
  );
}
