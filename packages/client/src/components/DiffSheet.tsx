/**
 * The diff review sheet: every row of the patch renders (no window cap)
 * inside a scrollbox, with file headers, hunk headers, and contiguous line
 * chunks. Line chunks draw through the native line-number gutter - custom
 * numbers per row (old numbers on deletions), the cursor as a gutter sign,
 * and annotation markers as line signs. Chunks split after an annotated row
 * so the annotation body renders directly under its line.
 */

import React, { useEffect, useMemo, useRef } from "react";
import type { LineNumberRenderable, LineSign, ScrollBoxRenderable } from "@opentui/core";
import type { Annotation } from "@cueloop/schema";
import type { DiffRow } from "../view-diff";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { truncateToSingleLine } from "./truncate-text";
import { AnnotationCard, type AnnotationDraft } from "./AnnotationCard";

export interface DiffComposeState {
  kind: "comment" | "suggestion";
  rowIndex: number;
  quote: string;
  draft: AnnotationDraft;
}

export interface DiffSheetProps {
  rows: DiffRow[];
  cursor: number;
  annotations: Annotation[];
  focusedAnnotationId?: string;
  compose?: DiffComposeState | null;
  theme?: Theme;
}

type DiffSegment =
  | { kind: "header"; rowIndex: number; row: DiffRow }
  | { kind: "chunk"; firstRowIndex: number; rows: DiffRow[]; annotation: Annotation | null };

/** Row text carries the patch's trailing newline; rendering strips it. */
function rowLine(row: DiffRow): string {
  return row.text.replace(/\n$/, "");
}

/** Chunks split after an annotated or composed row so a card can sit below. */
function segmentRows(rows: DiffRow[], annotatedByRow: Map<number, Annotation>, composeRowIndex?: number): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let chunk: DiffRow[] = [];
  let chunkStart = 0;
  const closeChunk = (annotation: Annotation | null): void => {
    if (chunk.length) segments.push({ kind: "chunk", firstRowIndex: chunkStart, rows: chunk, annotation });
    chunk = [];
  };
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    if (row.kind === "file" || row.kind === "hunk") {
      closeChunk(null);
      segments.push({ kind: "header", rowIndex, row });
      chunkStart = rowIndex + 1;
      continue;
    }
    if (!chunk.length) chunkStart = rowIndex;
    chunk.push(row);
    const annotation = annotatedByRow.get(rowIndex);
    if (annotation) {
      closeChunk(annotation);
      chunkStart = rowIndex + 1;
    } else if (rowIndex === composeRowIndex) {
      closeChunk(null);
      chunkStart = rowIndex + 1;
    }
  }
  closeChunk(null);
  return segments;
}

function DiffChunk({
  segment,
  cursor,
  focusedAnnotationId,
  theme,
}: {
  segment: Extract<DiffSegment, { kind: "chunk" }>;
  cursor: number;
  focusedAnnotationId?: string;
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
      colors.set(segment.rows.length - 1, { gutter: undefined, content: tokens.markCommentBackground });
    }
    if (cursorInChunk >= 0 && cursorInChunk < segment.rows.length) {
      colors.set(cursorInChunk, { gutter: tokens.cursorBackground, content: tokens.cursorBackground });
    }
    return colors;
  }, [segment, cursorInChunk, tokens]);

  // gutter state flows through the imperative surface: the renderable keeps
  // no prop setters for these maps, so updates land via effects
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
            const sign = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
            const foreground = row.kind === "add" ? tokens.insertedForeground : row.kind === "del" ? tokens.deletedForeground : tokens.textMuted;
            const isCursorRow = lineIndex === cursorInChunk;
            const isAnnotatedRow = segment.annotation !== null && lineIndex === segment.rows.length - 1;
            return (
              <span
                key={lineIndex}
                fg={foreground}
                bg={isCursorRow ? tokens.cursorBackground : isAnnotatedRow ? tokens.markCommentBackground : undefined}
              >
                {(lineIndex > 0 ? "\n" : "") + sign + rowLine(row)}
              </span>
            );
          })}
        </text>
      </line-number>
      {segment.annotation ? (
        <text>
          <span fg={tokens.textDim}>{"      "}</span>
          <span fg={segment.annotation.id === focusedAnnotationId ? tokens.text : tokens.accent}>
            ◆ {truncateToSingleLine(segment.annotation.body, 70)}
          </span>
        </text>
      ) : null}
    </box>
  );
}

export function DiffSheet({ rows, cursor, annotations, focusedAnnotationId, compose, theme }: DiffSheetProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  const annotatedByRow = useMemo(() => {
    const byRow = new Map<number, Annotation>();
    for (const annotation of annotations) {
      const rowIndex = rows.findIndex(
        (row) => row.text === annotation.anchor.quote && (row.kind === "ctx" || row.kind === "add" || row.kind === "del"),
      );
      if (rowIndex !== -1) byRow.set(rowIndex, annotation);
    }
    return byRow;
  }, [rows, annotations]);

  const segments = useMemo(
    () => segmentRows(rows, annotatedByRow, compose?.rowIndex),
    [rows, annotatedByRow, compose?.rowIndex],
  );

  // content y offset per row index, for cursor-following scroll
  const rowOffsets = useMemo(() => {
    const offsets: number[] = [];
    let contentY = 0;
    for (const segment of segments) {
      if (segment.kind === "header") {
        offsets[segment.rowIndex] = contentY;
        contentY += 1;
      } else {
        segment.rows.forEach((_, lineIndex) => {
          offsets[segment.firstRowIndex + lineIndex] = contentY + lineIndex;
        });
        contentY += segment.rows.length + (segment.annotation ? 1 : 0);
      }
    }
    return offsets;
  }, [segments]);

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
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <scrollbox ref={scrollRef} style={{ flexGrow: 1 }} focused={false}>
        {segments.map((segment, segmentIndex) => {
          if (segment.kind === "header") {
            const isCursor = segment.rowIndex === cursor;
            if (segment.row.kind === "file") {
              return (
                <text key={segmentIndex} fg={tokens.text} bg={isCursor ? tokens.cursorBackground : tokens.panel}>
                  {isCursor ? "▎" : " "}■ {rowLine(segment.row)}
                </text>
              );
            }
            return (
              <text key={segmentIndex} fg={tokens.blue} bg={isCursor ? tokens.cursorBackground : undefined}>
                {isCursor ? "▎" : " "}
                {rowLine(segment.row)}
              </text>
            );
          }
          const lastRowIndex = segment.firstRowIndex + segment.rows.length - 1;
          return (
            <React.Fragment key={segmentIndex}>
              <DiffChunk segment={segment} cursor={cursor} focusedAnnotationId={focusedAnnotationId} theme={theme} />
              {compose && compose.rowIndex === lastRowIndex ? (
                <AnnotationCard kind={compose.kind} quote={compose.quote} draft={compose.draft} theme={theme} />
              ) : null}
            </React.Fragment>
          );
        })}
      </scrollbox>
    </box>
  );
}
