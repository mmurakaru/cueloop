/**
 * The plan document sheet: header chrome, the reconciliation banner, and the
 * scrollable block flow. Each prose block renders as one natively wrapped
 * text (wrapMode "word") beside a marker gutter, so wrapping is the
 * renderer's job; the sheet keeps the rendered/work offset mapping per block
 * and exposes an imperative selection surface - the keyboard span drives the
 * native selection, and a mouse drag reads back as an exact work-text range,
 * which keeps quote anchors char-precise.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useRenderer } from "@opentui/react";
import { createTextAttributes, type ScrollBoxRenderable, type TextRenderable } from "@opentui/core";
import type { ReviewSession } from "@cueloop/schema";
import {
  blockRuns,
  displayText,
  overlayMarks,
  renderedOffsetFor,
  workRangeForRendered,
  type DisplayBlock,
  type Mark,
  type SpanState,
  type StyleRun,
} from "../view-plan";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { CodeBlock } from "./CodeBlock";
import { AnnotationCard, type AnnotationDraft } from "./AnnotationCard";
import { MarkerPopover, type MarkerPopoverProps } from "./MarkerPopover";
import { FRAME_BORDER_STYLE } from "./primitives/frame";

/** A cut block reads as removed: struck through and grayed, never red. */
const CUT_ATTRIBUTES = createTextAttributes({ strikethrough: true, dim: true });

export interface PlanSelection {
  displayIndex: number;
  start: number;
  end: number;
}

export interface PlanSheetHandle {
  /** Work-text range of the current native (mouse) selection, if any. */
  /** The current native selection; `preferredIndex` (the mouse-up block) re-anchors a fresh drag. */
  readSelection(preferredIndex?: number): PlanSelection | null;
  /** Anchor/extend the renderer's native selection from keyboard span offsets. */
  driveSpanSelection(span: SpanState): void;
  clearSelection(): void;
  revealBlock(displayIndex: number): void;
}

export interface PlanComposeState {
  kind: "comment";
  displayIndex: number;
  quote: string;
  draft: AnnotationDraft;
}

/** The marker-actions popover, rendered inline at its block while span mode is live. */
export interface PlanPopoverState extends MarkerPopoverProps {
  displayIndex: number;
}

export interface PlanSheetProps {
  session: ReviewSession;
  display: DisplayBlock[];
  marks: Map<number, Mark[]>;
  cursor: number;
  /** Extra selection-style paint on one block (keyboard span or compose anchor). */
  activeSpan: { displayIndex: number; start: number; end: number } | null;
  compose: PlanComposeState | null;
  /** The marker-actions popover for the span's block; null when not in span mode. */
  popover: PlanPopoverState | null;
  editOrphanCount: number;
  onLineActivate: (displayIndex: number) => void;
  theme?: Theme;
}

interface BlockRef {
  renderable: TextRenderable;
  runs: StyleRun[];
}

/** Screen position of a rendered-text offset inside a wrapped text. */
function positionOfRenderedOffset(
  renderable: TextRenderable,
  renderedOffset: number,
): { x: number; y: number } {
  const info = renderable.lineInfo;
  let lineIndex = 0;
  for (let index = 0; index < info.lineStartCols.length; index++) {
    if (info.lineStartCols[index]! <= renderedOffset) lineIndex = index;
    else break;
  }
  return {
    x: renderable.x + renderedOffset - (info.lineStartCols[lineIndex] ?? 0),
    y: renderable.y + lineIndex,
  };
}

export const PlanSheet = forwardRef<PlanSheetHandle, PlanSheetProps>(function PlanSheet(
  {
    display,
    marks,
    cursor,
    activeSpan,
    compose,
    popover,
    editOrphanCount,
    onLineActivate,
    theme,
  }: PlanSheetProps,
  handleRef,
): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const renderer = useRenderer();
  const blockRefs = useRef(new Map<number, BlockRef>());
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  useImperativeHandle(handleRef, () => ({
    readSelection: (preferredIndex?: number): PlanSelection | null => {
      if (!renderer?.hasSelection) return null;
      const readBlock = (displayIndex: number): PlanSelection | null => {
        const blockRef = blockRefs.current.get(displayIndex);
        if (!blockRef) return null;
        const selection = blockRef.renderable.getSelection();
        if (!selection || selection.end <= selection.start) return null;
        const range = workRangeForRendered(blockRef.runs, selection.start, selection.end);
        return range ? { displayIndex, ...range } : null;
      };
      // the block the mouse released on wins, so a fresh drag re-anchors the span
      // (one marker at a time) instead of sticking to the topmost prior selection
      if (preferredIndex !== undefined) {
        const preferred = readBlock(preferredIndex);
        if (preferred) return preferred;
      }
      for (const displayIndex of [...blockRefs.current.keys()].sort(
        (left, right) => left - right,
      )) {
        const found = readBlock(displayIndex);
        if (found) return found;
      }
      return null;
    },
    driveSpanSelection: (span: SpanState): void => {
      if (!renderer) return;
      const blockRef = blockRefs.current.get(span.displayIndex);
      if (!blockRef) return;
      const renderedStart = renderedOffsetFor(blockRef.runs, span.start);
      const renderedEnd = renderedOffsetFor(blockRef.runs, span.end - 1);
      if (renderedStart === null || renderedEnd === null) return;
      const startPosition = positionOfRenderedOffset(blockRef.renderable, renderedStart);
      const endPosition = positionOfRenderedOffset(blockRef.renderable, renderedEnd);
      renderer.startSelection(blockRef.renderable, startPosition.x, startPosition.y);
      renderer.updateSelection(blockRef.renderable, endPosition.x + 1, endPosition.y);
    },
    clearSelection: (): void => {
      renderer?.clearSelection();
    },
    revealBlock: (displayIndex: number): void => {
      try {
        scrollRef.current?.scrollChildIntoView(`plan-block-${displayIndex}`);
      } catch {
        // reveal is best-effort; selection state is already correct
      }
    },
  }));

  const registerBlock = (
    displayIndex: number,
    renderable: TextRenderable | null,
    runs: StyleRun[],
  ): void => {
    if (renderable) blockRefs.current.set(displayIndex, { renderable, runs });
    else blockRefs.current.delete(displayIndex);
  };
  // stale refs must not survive a shrinking display list
  useEffect(() => {
    for (const displayIndex of blockRefs.current.keys()) {
      if (displayIndex >= display.length) blockRefs.current.delete(displayIndex);
    }
  }, [display]);

  const children: React.ReactNode[] = [];
  for (let displayIndex = 0; displayIndex < display.length; displayIndex++) {
    const block = display[displayIndex]!;
    const isCursor = displayIndex === cursor;
    const gap = topGap(display[displayIndex - 1], block);
    if (block.kind === "code") {
      children.push(
        <CodeBlock
          key={displayIndex}
          id={`plan-block-${displayIndex}`}
          language={(block.work ?? block.base)?.lang}
          content={displayText(block)}
          isCursor={isCursor}
          marginTop={gap}
          isAnnotated={(marks.get(displayIndex) ?? []).length > 0}
          changeTag={showsChangeTag(block) ? tagLabel(block) : undefined}
          cut={block.type === "del"}
          theme={theme}
        />,
      );
    } else {
      const blockMarks = [...(marks.get(displayIndex) ?? [])];
      if (activeSpan && activeSpan.displayIndex === displayIndex) {
        blockMarks.push({ start: activeSpan.start, end: activeSpan.end, role: "kspan" });
      }
      const runs = overlayMarks(blockRuns(block, true), blockMarks);
      // the change tag participates in the rendered text but carries no offsets;
      // a cut block shows no tag (its strikethrough already reads as removed)
      const mappedRuns: StyleRun[] = showsChangeTag(block)
        ? [...runs, { text: ` [${tagLabel(block)}]`, role: "plain", start: null }]
        : runs;
      children.push(
        <box
          key={displayIndex}
          id={`plan-block-${displayIndex}`}
          style={{ flexDirection: "row", marginTop: gap }}
        >
          <text selectable={false}>
            <span fg={isCursor ? tokens.accent : tokens.textDim}>{isCursor ? "▎ " : "  "}</span>
            <span fg={tokens.textDim}>{marker(block)}</span>
          </text>
          <text
            bg={isCursor ? tokens.cursorBackground : undefined}
            selectable
            selectionBg={tokens.accent}
            selectionFg={tokens.accentInk}
            style={{ wrapMode: "word", flexGrow: 1, flexShrink: 1 }}
            ref={(renderable: TextRenderable | null) =>
              registerBlock(displayIndex, renderable, mappedRuns)
            }
            onMouseUp={() => onLineActivate(displayIndex)}
          >
            {runs.map((run, runIndex) => (
              <span key={runIndex} {...runStyle(run, block, tokens)}>
                {run.text}
              </span>
            ))}
            {showsChangeTag(block) ? (
              <span fg={tagColor(block, tokens)}> [{tagLabel(block)}]</span>
            ) : null}
          </text>
        </box>,
      );
    }
    if (compose && compose.displayIndex === displayIndex) {
      children.push(
        <AnnotationCard
          key={`compose-${displayIndex}`}
          kind={compose.kind}
          quote={compose.quote}
          draft={compose.draft}
          theme={theme}
        />,
      );
    }
    if (popover && popover.displayIndex === displayIndex) {
      children.push(<MarkerPopover key={`popover-${displayIndex}`} {...popover} theme={theme} />);
    }
  }

  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <box
        style={{
          flexGrow: 1,
          flexDirection: "column",
          border: true,
          borderStyle: FRAME_BORDER_STYLE,
          borderColor: tokens.text,
        }}
      >
        {editOrphanCount > 0 ? (
          <box style={{ height: 1, backgroundColor: tokens.markCommentBackground, paddingLeft: 1 }}>
            <text fg={tokens.red}>
              {editOrphanCount} annotation{editOrphanCount === 1 ? "" : "s"} no longer match - the
              passage was removed.
            </text>
          </box>
        ) : null}
        <scrollbox
          ref={scrollRef}
          style={{ flexGrow: 1, paddingLeft: 1, paddingTop: 0 }}
          focused={false}
        >
          {children}
        </scrollbox>
      </box>
    </box>
  );
});

/** Vertical rhythm: gaps live ABOVE blocks so boundaries never collapse. */
function topGap(previous: DisplayBlock | undefined, current: DisplayBlock): number {
  if (!previous) return 0;
  const tightPair =
    (current.kind === "li" && previous.kind === "li") ||
    (current.kind === "oli" && previous.kind === "oli");
  return tightPair ? 0 : 1;
}

function marker(block: DisplayBlock): string {
  if (block.kind === "li") return "- ";
  if (block.kind === "oli") return `${block.orderedItemNumber ?? 1}. `;
  if (block.kind === "quote") return "▏ ";
  return "";
}

/** An added or edited block earns a tag; a cut block relies on its strikethrough. */
function showsChangeTag(block: DisplayBlock): boolean {
  return block.type === "add" || block.type === "mod";
}

function tagLabel(block: DisplayBlock): "new" | "edited" {
  return block.type === "add" ? "new" : "edited";
}

function tagColor(block: DisplayBlock, tokens: Theme): string {
  return block.type === "add" ? tokens.green : tokens.accent;
}

function runStyle(
  run: StyleRun,
  block: DisplayBlock,
  tokens: Theme,
): { fg?: string; bg?: string; attributes?: number } {
  // a cut block reads as removed: every run struck through and grayed, never red
  if (block.type === "del") return { fg: tokens.textDim, attributes: CUT_ATTRIBUTES };
  const headingFg =
    block.kind === "h1"
      ? tokens.text
      : block.kind === "h2" || block.kind === "h3"
        ? tokens.accent
        : undefined;
  switch (run.role) {
    case "ins":
      return { fg: tokens.insertedForeground };
    case "del":
      return { fg: tokens.deletedForeground };
    case "mark-comment":
      return { fg: tokens.text, bg: tokens.markCommentBackground };
    case "mark-focus":
      return { fg: tokens.accentInk, bg: tokens.accent };
    case "kspan":
      return { fg: tokens.accentInk, bg: tokens.accent };
    default:
      return { fg: headingFg ?? tokens.text };
  }
}
