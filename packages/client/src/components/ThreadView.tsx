/**
 * The thread view: the plan surface where discussions live inline in the
 * document instead of the rail. The caret, marks, composer, palette, and cards
 * come from the shared annotation surface (the diff sheet drives the same hook);
 * this view paints the plan's blocks - headings, lists, quotes, tracked changes -
 * and the right-edge scroll markers that navigate between discussions.
 *
 * Grammar: arrows move (caret flows across blocks) · shift+arrows select ·
 * click/drag mark · typing comments (or edits my trailing comment / replies
 * in a focused discussion) · "/" opens the quick-action palette · cmd+option+m
 * comments on selection · cmd+enter sends, enter breaks the line · esc
 * dismisses · tab folds · cmd+[ / cmd+] cycle discussions · blur-save on click.
 */

import React, { useEffect, useRef, useState } from "react";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { ReviewSession } from "@cueloop/schema";
import { displayText, type DisplayBlock, type Mark } from "../view-plan";
import type { TextSpan } from "../thread-selection";
import type { QuickAction } from "../config";
import type { CheatsheetSection } from "../key-bindings";
import type { Theme } from "../theme";
import { BOLD, CUT, UNDERLINE } from "../annotation-palette";
import { lineMarkRanges, runsFor, wrapLines, type MarkRange, type VisualLine } from "../mark-runs";
import type { Discussion } from "../discussions";
import { useFrameMeasure } from "../use-frame-measure";
import { useAnnotationSurface, type LineSource } from "../use-annotation-surface";
import { useComponentTheme } from "./theme-context";
import { useRootOverlay } from "./RootOverlay";

export { lighten } from "../annotation-palette";
export { inlineSlashToken, resolveInlineSuggestion } from "../slash-palette";

/* ---------------------------------------------------------- scroll markers */

function ScrollMarkers({
  discussions,
  hovered,
  tokens,
  onHover,
  onJump,
}: {
  discussions: Discussion[];
  hovered: string | null;
  tokens: Theme;
  onHover: (marker: { key: string; screenY: number; anchorX: number } | null) => void;
  onJump: (key: string) => void;
}): React.ReactNode {
  const railRef = useRef<BoxRenderable | null>(null);
  const height = useFrameMeasure(
    () => railRef.current?.height ?? 0,
    (left, right) => left === right,
    0,
  );

  const firstRow = Math.max(0, Math.floor((height - discussions.length) / 2));
  const rowFor = (index: number): number => firstRow + index;
  const indexAt = (row: number): number | null => {
    const index = row - firstRow;

    return index >= 0 && index < discussions.length ? index : null;
  };
  const hoveredIndex = discussions.findIndex((discussion) => discussion.key === hovered);
  const colorFor = (index: number): string => {
    if (index === hoveredIndex) return tokens.text;
    if (hoveredIndex >= 0 && discussions.length >= 5 && Math.abs(index - hoveredIndex) === 1) {
      return tokens.textMuted;
    }

    return tokens.textDim;
  };

  return (
    <box
      ref={railRef}
      style={{ width: 3, flexShrink: 0, flexDirection: "column" }}
      onMouseMove={(event) => {
        const railY = railRef.current?.y ?? 0;
        const index = indexAt(event.y - railY);

        onHover(
          index === null
            ? null
            : {
                key: discussions[index]!.key,
                // screen coordinates so the preview can render at the app root, above every pane rule
                screenY: railY + rowFor(index),
                anchorX: railRef.current?.x ?? 0,
              },
        );
      }}
      onMouseOut={() => onHover(null)}
      onMouseDown={(event) => {
        const index = indexAt(event.y - (railRef.current?.y ?? 0));

        if (index !== null) onJump(discussions[index]!.key);
      }}
    >
      {discussions.map((discussion, index) => (
        <text
          key={discussion.key}
          selectable={false}
          style={{ position: "absolute", top: rowFor(index), left: 0 }}
          fg={colorFor(index)}
        >
          {(index === hoveredIndex ? "●" : "○").padStart(2)}
        </text>
      ))}
    </box>
  );
}

/**
 * How a block's rows are painted: heading weight, muted kinds, the list or
 * quote marker, and tracked changes as the plan sheet drew them - a cut block
 * dim and struck through, an added or edited block tagged on its first row.
 */
interface BlockStyle {
  baseFg: string;
  baseAttributes: number;
  marker: string;
  changeTag: { text: string; fg: string } | null;
}

function blockStyle(block: DisplayBlock, tokens: Theme): BlockStyle {
  const isHeading = block.kind === "h1" || block.kind === "h2" || block.kind === "h3";
  const isCut = block.type === "del";
  const muted = block.kind === "h2" || block.kind === "h3" || block.kind === "code";
  const marker =
    block.kind === "li"
      ? "· "
      : block.kind === "oli"
        ? `${block.orderedItemNumber ?? 1}. `
        : block.kind === "quote"
          ? "▏ "
          : "";
  const changeTag =
    block.type === "add"
      ? { text: " [new]", fg: tokens.green }
      : block.type === "mod"
        ? { text: " [edited]", fg: tokens.accent }
        : null;

  return {
    baseFg: isCut ? tokens.textDim : muted ? tokens.textMuted : tokens.text,
    baseAttributes: (isHeading ? BOLD : 0) | (isCut ? CUT : 0),
    marker,
    changeTag,
  };
}

/* ------------------------------------------------------------------ view */

/** The grammar as the keybinds dialog lists it; the view owns these keys, so they are not rebindable. */
export const THREAD_VIEW_CHEATSHEET: CheatsheetSection[] = [
  {
    title: "Thread",
    entries: [
      { keys: "click", label: "place the caret" },
      { keys: "drag", label: "mark text, across blocks" },
      { keys: "dbl-click", label: "mark the word" },
      { keys: "← / →", label: "move by word" },
      { keys: "⇧← / ⇧→", label: "hold a mark" },
      { keys: "↑ / ↓", label: "move by block" },
      { keys: "type", label: "comment on the mark" },
      { keys: "⌘⌥m", label: "comment" },
      { keys: "enter", label: "reply to the comment" },
      { keys: "tab", label: "fold / unfold" },
      { keys: "⌘] / ⌘[", label: "next / previous comment" },
      { keys: "esc", label: "drop the mark" },
      { keys: "⌃q", label: "quit" },
    ],
  },
  {
    title: "Comment",
    entries: [
      { keys: "⌘enter", label: "send (⌃enter as well)" },
      { keys: "enter", label: "new line" },
      { keys: "backspace", label: "dismiss an empty draft" },
      { keys: "/", label: "actions" },
      { keys: "click away", label: "save" },
    ],
  },
];

export interface ThreadViewProps {
  session: ReviewSession;
  display: DisplayBlock[];
  marks: Map<number, Mark[]>;
  quickActions: QuickAction[];
  observer: boolean;
  /** True while a menu, dialog, or overlay owns the keyboard. */
  suspended?: boolean;
  /** Comments an edit orphaned: their passage is gone from the working copy. */
  editOrphanCount?: number;
  /** Reports whether a composer is open, so session chords can yield to typing. */
  onComposingChange?: (composing: boolean) => void;
  /** A verdict is in: no draft may open; the app answers with its read-only status. */
  resolved?: boolean;
  /** An observer or a resolved review refused a draft; the app shows why. */
  onObserverBlocked?: (reason: "observer" | "resolved") => void;
  /** Reports the caret's block, so block-level primitives (cut, restore) act where the caret is. */
  onCursorChange?: (blockIndex: number) => void;
  /** The rail's focused card; the discussion holding it takes focus here. */
  focusedAnnotationId?: string;
  /** Reports the focused discussion's root comment, so the rail follows. */
  onFocusAnnotation?: (annotationId: string | undefined) => void;
  onAnnotate: (span: TextSpan, body: string) => void;
  onReply: (rootAnnotationId: string, body: string) => void;
  onUpdateAnnotation: (id: string, body: string) => void;
  onExit: () => void;
  theme?: Theme;
}

export function ThreadView({
  session,
  display,
  marks,
  quickActions,
  observer,
  resolved = false,
  suspended = false,
  editOrphanCount = 0,
  onComposingChange,
  onObserverBlocked,
  onCursorChange,
  focusedAnnotationId,
  onFocusAnnotation,
  onAnnotate,
  onReply,
  onUpdateAnnotation,
  onExit,
  theme,
}: ThreadViewProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const source: LineSource = {
    count: display.length,
    textAt: (blockIndex) => displayText(display[blockIndex]!),
    annotatable: () => true,
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
  const { palette, discussions } = surface;
  const [hoveredMarker, setHoveredMarker] = useState<{
    key: string;
    screenY: number;
    anchorX: number;
  } | null>(null);
  const { setOverlay, clearOverlay } = useRootOverlay();
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const viewWidth = useFrameMeasure(
    () => scrollRef.current?.content?.width ?? 0,
    (left, right) => left === right,
    0,
  );

  useEffect(() => {
    try {
      scrollRef.current?.scrollChildIntoView(`discussion-block-${surface.revealBlockIndex}`);
    } catch {
      // best-effort reveal
    }
  }, [surface.revealBlockIndex]);

  interface LineContext {
    blockIndex: number;
    text: string;
    line: VisualLine;
    lineIndex: number;
    ranges: MarkRange[];
    marker: string;
    baseFg: string;
    baseAttributes: number;
    /** A tag after the row's text, such as the tracked-change label. */
    trailing: { text: string; fg: string } | null;
  }

  const lineRowFor = (context: LineContext): React.ReactNode => {
    const { blockIndex, text, line, lineIndex, ranges, marker, baseFg, baseAttributes, trailing } =
      context;
    const lineRanges = lineMarkRanges(ranges, line);

    return (
      <box key={`line-${lineIndex}`} style={{ flexDirection: "row" }}>
        <text selectable={false}>
          <span fg={tokens.textDim}>{"  "}</span>
          <span fg={tokens.textDim}>{lineIndex === 0 ? marker : " ".repeat(marker.length)}</span>
        </text>
        <text
          selectable={false}
          style={{ flexGrow: 1, flexShrink: 1 }}
          ref={surface.registerLine(blockIndex, lineIndex, line)}
          onMouseDown={surface.onLineMouseDown}
        >
          {runsFor(text.slice(line.start, line.end), lineRanges).map((run, runIndex) => (
            <span
              key={runIndex}
              fg={baseFg}
              bg={run.caretOnly ? palette.caretCell : run.marked ? palette.markBackdrop : undefined}
              attributes={baseAttributes | (run.marked ? UNDERLINE : 0)}
            >
              {run.text}
            </span>
          ))}
          {trailing ? <span fg={trailing.fg}>{trailing.text}</span> : null}
        </text>
      </box>
    );
  };

  const blockNodeFor = (blockIndex: number): React.ReactNode => {
    const block = display[blockIndex]!;
    const text = displayText(block);
    const ranges = surface.rangesFor(blockIndex);
    const { baseFg, baseAttributes, marker, changeTag } = blockStyle(block, tokens);
    const lines = wrapLines(text, viewWidth > 0 ? viewWidth - marker.length - 6 : 0);
    const lineRows: React.ReactNode[] = [];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]!;
      const isLastLine = lineIndex === lines.length - 1;

      lineRows.push(
        lineRowFor({
          blockIndex,
          text,
          line,
          lineIndex,
          ranges,
          marker,
          baseFg,
          baseAttributes,
          trailing: lineIndex === 0 ? changeTag : null,
        }),
      );
      const cards = surface.cardsAfterLine(blockIndex, line, isLastLine);

      lineRows.push(...cards);
      if (cards.length > 0 && !isLastLine) {
        lineRows.push(<box key={`gap-${lineIndex}`} style={{ height: 1 }} />);
      }
    }

    // list items of one list stay tight; every other block sits a blank row
    // below its neighbour, and a code block announces its language first
    const previous = display[blockIndex - 1];
    const tight =
      previous !== undefined &&
      block.kind === previous.kind &&
      (block.kind === "li" || block.kind === "oli");
    const languageRow =
      block.kind === "code" ? (
        <text key="language" fg={tokens.textDim} selectable={false}>
          {`  ${block.work?.lang ?? block.base?.lang ?? "code"}`}
        </text>
      ) : null;

    return (
      <box
        key={`discussion-block-${blockIndex}`}
        id={`discussion-block-${blockIndex}`}
        style={{ flexDirection: "column", marginTop: blockIndex === 0 || tight ? 0 : 1 }}
      >
        {languageRow}
        {lineRows}
      </box>
    );
  };

  const markerPreview = (): React.ReactNode => {
    if (hoveredMarker === null) return null;
    const preview = discussions.find((discussion) => discussion.key === hoveredMarker.key);

    if (!preview) return null;
    const quote = surface.spanQuote(preview.span);
    const lastComment = preview.annotations.at(-1)!;

    return (
      <box
        style={{
          position: "absolute",
          top: Math.max(0, hoveredMarker.screenY - 1),
          left: Math.max(0, hoveredMarker.anchorX - 48),
          width: 48,
          flexDirection: "column",
          border: true,
          borderStyle: "single",
          borderColor: tokens.border,
          backgroundColor: tokens.elevated,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={tokens.textDim}>{`"${quote.slice(0, 42)}"`}</text>
        <text fg={tokens.text}>
          {`${lastComment.author === undefined ? "●" : "○"} ${lastComment.body}`.slice(0, 44)}
        </text>
        <text fg={tokens.textDim}>
          {`${preview.annotations.length} comment${
            preview.annotations.length === 1 ? "" : "s"
          } · click to jump`}
        </text>
      </box>
    );
  };

  // render the marker preview at the app root (above every pane rule); OpenTUI has no z-index, so an
  // absolute box inside this pane would be sliced by the next pane's border
  useEffect(() => {
    setOverlay(markerPreview());

    return () => clearOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredMarker, discussions, tokens]);

  return (
    <box style={{ flexGrow: 1, flexDirection: "row" }} {...surface.rootMouseProps}>
      <box style={{ flexGrow: 1, flexDirection: "column" }}>
        {editOrphanCount > 0 ? (
          <box style={{ height: 1, backgroundColor: palette.markBackdrop, paddingLeft: 2 }}>
            <text fg={tokens.red}>
              {`${editOrphanCount} annotation${editOrphanCount === 1 ? "" : "s"} no longer match - the passage was removed.`}
            </text>
          </box>
        ) : null}
        <scrollbox ref={scrollRef} style={{ flexGrow: 1, paddingTop: 1 }} focused={false}>
          {display.map((_block, blockIndex) => blockNodeFor(blockIndex))}
        </scrollbox>
      </box>
      <ScrollMarkers
        discussions={discussions}
        hovered={hoveredMarker?.key ?? null}
        tokens={tokens}
        onHover={setHoveredMarker}
        onJump={surface.jumpToDiscussion}
      />
    </box>
  );
}
