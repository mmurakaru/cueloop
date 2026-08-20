/**
 * The diff review sheet: a thin renderer over diff-sheet-layout. Rows render (no
 * window cap) in a scrollbox with file/hunk headers and contiguous code chunks.
 * A chunk draws through the native line-number gutter - custom numbers per row,
 * the cursor as a gutter sign, annotation markers as line signs - and closes
 * after an annotated row so the annotation body sits under its line. A
 * curated-out row renders struck through.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createTextAttributes,
  type LineNumberRenderable,
  type LineSign,
  type ScrollBoxRenderable,
} from "@opentui/core";
import type { Annotation } from "@cueloop/schema";
import type { DiffRow } from "../view-diff";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { truncateToSingleLine } from "./truncate-text";
import { AnnotationCard, type AnnotationDraft } from "./AnnotationCard";
import { FRAME_BORDER_STYLE } from "./primitives/frame";
import { intralineRunsByRow, type IntralineRun } from "../diff-intraline";
import { highlightDiffRows, type SyntaxSpan } from "../diff-syntax";
import {
  annotatedRowsByIndex,
  coloredRowSpans,
  rowContentOffsets,
  rowLine,
  segmentRows,
  type DiffSegment,
} from "./diff-sheet-layout";

/** Shared empty map so an unresolved/stale highlight state is a stable value. */
const EMPTY_SYNTAX: Map<number, SyntaxSpan[]> = new Map();

/** Shared empty set so "nothing rejected" is a stable identity for renders. */
const EMPTY_REJECTED: Set<number> = new Set();

/** A rejected (curated-out) change row renders struck through and dimmed. */
const REJECTED_ATTRIBUTES = createTextAttributes({ strikethrough: true, dim: true });

export interface DiffComposeState {
  kind: "comment";
  rowIndex: number;
  quote: string;
  draft: AnnotationDraft;
}

export interface DiffSheetProps {
  rows: DiffRow[];
  cursor: number;
  annotations: Annotation[];
  focusedAnnotationId?: string;
  /** Row indices the owner rejected during curation; drawn struck through. */
  rejectedRows?: Set<number>;
  compose?: DiffComposeState | null;
  theme?: Theme;
}

/** The sign, base color, and background a row draws with. */
function rowStyle(
  row: DiffRow,
  isCursorRow: boolean,
  isAnnotatedRow: boolean,
  tokens: Theme,
): { sign: string; baseColor: string; background: string | undefined } {
  const sign = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
  const baseColor =
    row.kind === "add"
      ? tokens.insertedForeground
      : row.kind === "del"
        ? tokens.deletedForeground
        : tokens.textMuted;
  const background = isCursorRow
    ? tokens.cursorBackground
    : isAnnotatedRow
      ? tokens.markCommentBackground
      : undefined;
  return { sign, baseColor, background };
}

function DiffChunk({
  segment,
  cursor,
  focusedAnnotationId,
  intralineByRow,
  syntaxByRow,
  rejectedRows,
  theme,
}: {
  segment: Extract<DiffSegment, { kind: "chunk" }>;
  cursor: number;
  focusedAnnotationId?: string;
  intralineByRow: Map<number, IntralineRun[]>;
  syntaxByRow: Map<number, SyntaxSpan[]>;
  rejectedRows: Set<number>;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const gutterRef = useRef<LineNumberRenderable | null>(null);
  const cursorInChunk = cursor - segment.firstRowIndex;

  const lineNumbers = useMemo(() => {
    const numbers = new Map<number, number>();
    segment.rows.forEach((row, lineIndex) => {
      const gutterNumber = row.kind === "del" ? row.oldLine : row.newLine;
      if (gutterNumber !== undefined) numbers.set(lineIndex, gutterNumber);
    });
    return numbers;
  }, [segment]);

  const lineSigns = useMemo(() => {
    const signs = new Map<number, LineSign>();
    if (cursorInChunk >= 0 && cursorInChunk < segment.rows.length) {
      signs.set(cursorInChunk, { before: "▎", beforeColor: tokens.accent });
    }
    if (segment.annotation) {
      signs.set(segment.rows.length - 1, { after: "◆", afterColor: tokens.accent });
    }
    return signs;
  }, [segment, cursorInChunk, tokens]);

  const lineColors = useMemo(() => {
    // the renderable's config parser requires the gutter key to be present
    const colors = new Map<number, { gutter: string | undefined; content: string }>();
    if (segment.annotation) {
      colors.set(segment.rows.length - 1, {
        gutter: undefined,
        content: tokens.markCommentBackground,
      });
    }
    if (cursorInChunk >= 0 && cursorInChunk < segment.rows.length) {
      colors.set(cursorInChunk, {
        gutter: tokens.cursorBackground,
        content: tokens.cursorBackground,
      });
    }
    return colors;
  }, [segment, cursorInChunk, tokens]);

  // the gutter renderable has no prop setters for these maps, so they land via an effect
  useEffect(() => {
    const gutter = gutterRef.current;
    if (!gutter) return;
    gutter.setLineNumbers(lineNumbers);
    gutter.setLineSigns(lineSigns);
    gutter.clearAllLineColors();
    for (const [line, colorConfig] of lineColors) gutter.setLineColor(line, colorConfig);
  }, [lineNumbers, lineSigns, lineColors]);

  return (
    <box style={{ flexDirection: "column" }}>
      <line-number
        ref={gutterRef}
        fg={tokens.textDim}
        bg={tokens.background}
        minWidth={4}
        paddingRight={1}
        lineNumbers={lineNumbers}
        lineSigns={lineSigns}
      >
        <text style={{ wrapMode: "none" }} selectable={false}>
          {segment.rows.map((row, lineIndex) => {
            const isCursorRow = lineIndex === cursorInChunk;
            const isAnnotatedRow =
              segment.annotation !== null && lineIndex === segment.rows.length - 1;
            const { sign, baseColor, background } = rowStyle(
              row,
              isCursorRow,
              isAnnotatedRow,
              tokens,
            );
            const prefix = (lineIndex > 0 ? "\n" : "") + sign;
            const absoluteRowIndex = segment.firstRowIndex + lineIndex;

            // A rejected change collapses to one struck-through, dimmed span, so
            // it reads as excluded regardless of its syntax or intra-line colors.
            if (rejectedRows.has(absoluteRowIndex)) {
              return (
                <span
                  key={lineIndex}
                  fg={tokens.textDim}
                  bg={background}
                  attributes={REJECTED_ATTRIBUTES}
                >
                  {prefix + rowLine(row)}
                </span>
              );
            }

            const spans = coloredRowSpans(
              rowLine(row),
              intralineByRow.get(absoluteRowIndex),
              syntaxByRow.get(absoluteRowIndex),
              baseColor,
              tokens,
            );
            return (
              <React.Fragment key={lineIndex}>
                <span fg={baseColor} bg={background}>
                  {prefix}
                </span>
                {spans.map((span, spanIndex) => (
                  <span key={spanIndex} fg={span.foreground} bg={background}>
                    {span.text}
                  </span>
                ))}
              </React.Fragment>
            );
          })}
        </text>
      </line-number>

      {segment.annotation ? (
        // one row exactly: wrapMode none keeps the model's 1-line-per-card offset
        // honest, so the cursor-follow scroll never drifts past a wrapped card
        <text style={{ wrapMode: "none" }}>
          <span fg={tokens.textDim}>{"      "}</span>
          <span fg={segment.annotation.id === focusedAnnotationId ? tokens.text : tokens.accent}>
            ◆ {truncateToSingleLine(segment.annotation.body, 70)}
          </span>
        </text>
      ) : null}
    </box>
  );
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
  cursor,
  annotations,
  focusedAnnotationId,
  rejectedRows = EMPTY_REJECTED,
  compose,
  theme,
}: DiffSheetProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  const annotatedByRow = useMemo(
    () => annotatedRowsByIndex(rows, annotations),
    [rows, annotations],
  );
  const segments = useMemo(
    () => segmentRows(rows, annotatedByRow, compose?.rowIndex),
    [rows, annotatedByRow, compose?.rowIndex],
  );
  const intralineByRow = useMemo(() => intralineRunsByRow(rows), [rows]);
  const syntaxByRow = useSyntaxHighlights(rows);
  const rowOffsets = useMemo(() => rowContentOffsets(segments), [segments]);

  // follow the cursor: keep it a couple of rows inside the viewport
  useEffect(() => {
    const scrollbox = scrollRef.current;
    const cursorOffset = rowOffsets[cursor];
    if (!scrollbox || cursorOffset === undefined) return;
    const viewportHeight = Math.max(1, scrollbox.height);
    if (cursorOffset < scrollbox.scrollTop + 2) {
      scrollbox.scrollTo({ x: 0, y: Math.max(0, cursorOffset - 2) });
    } else if (cursorOffset > scrollbox.scrollTop + viewportHeight - 3) {
      scrollbox.scrollTo({ x: 0, y: cursorOffset - viewportHeight + 3 });
    }
  }, [cursor, rowOffsets]);

  return (
    <box
      style={{
        flexGrow: 1,
        flexDirection: "column",
        border: true,
        borderStyle: FRAME_BORDER_STYLE,
        borderColor: tokens.text,
        paddingLeft: 1,
        paddingTop: 0,
      }}
    >
      <scrollbox id="diff-scroll" ref={scrollRef} style={{ flexGrow: 1 }} focused={false}>
        {segments.map((segment, segmentIndex) => {
          if (segment.kind === "header") {
            const isCursor = segment.rowIndex === cursor;
            if (segment.row.kind === "file") {
              return (
                <text
                  key={segmentIndex}
                  fg={tokens.text}
                  bg={isCursor ? tokens.cursorBackground : tokens.panel}
                  style={{ wrapMode: "none" }}
                >
                  {isCursor ? "▎" : " "}■ {rowLine(segment.row)}
                </text>
              );
            }
            return (
              <text
                key={segmentIndex}
                fg={tokens.blue}
                bg={isCursor ? tokens.cursorBackground : undefined}
                style={{ wrapMode: "none" }}
              >
                {isCursor ? "▎" : " "}
                {rowLine(segment.row)}
              </text>
            );
          }

          const lastRowIndex = segment.firstRowIndex + segment.rows.length - 1;
          return (
            <React.Fragment key={segmentIndex}>
              <DiffChunk
                segment={segment}
                cursor={cursor}
                focusedAnnotationId={focusedAnnotationId}
                intralineByRow={intralineByRow}
                syntaxByRow={syntaxByRow}
                rejectedRows={rejectedRows}
                theme={theme}
              />
              {compose && compose.rowIndex === lastRowIndex ? (
                <AnnotationCard
                  kind={compose.kind}
                  quote={compose.quote}
                  draft={compose.draft}
                  theme={theme}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </scrollbox>
    </box>
  );
}
