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

import React, { useEffect, useRef } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import type { Annotation, Thread } from "@cueloop/schema";
import { displayText, type DisplayBlock, type Mark } from "../view-plan";
import type { TextSpan } from "../thread-selection";
import type { QuickAction } from "../config";
import type { CheatsheetSection } from "../key-bindings";
import type { Theme } from "../theme";
import { BOLD, CUT, UNDERLINE } from "../annotation-palette";
import { lineMarkRanges, runsFor, wrapLines, type MarkRange, type VisualLine } from "../mark-runs";
import { useFrameMeasure } from "../use-frame-measure";
import { useTerminalVirtualizer } from "../use-terminal-virtualizer";
import { useAnnotationSurface, type LineSource } from "../use-annotation-surface";
import { DiscussionMarkerRail } from "./DiscussionMarkerRail";
import { useComponentTheme } from "./theme-context";

/** Blocks kept mounted beyond the viewport, so a scroll step or a drag past the edge never shows a gap. */
const OVERSCAN_BLOCKS = 8;

export { lighten } from "../annotation-palette";

/**
 * How a block's rows are painted: heading weight, muted kinds, and the list or
 * quote marker. A cut block reads dim and struck through; other edits are
 * tracked into the working copy but not tagged in the read-only view.
 */
interface BlockStyle {
  baseFg: string;
  baseAttributes: number;
  marker: string;
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

  return {
    baseFg: isCut ? tokens.textDim : muted ? tokens.textMuted : tokens.text,
    baseAttributes: (isHeading ? BOLD : 0) | (isCut ? CUT : 0),
    marker,
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
  session: Thread;
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
  /** The author's display name for a comment's hover tooltip. */
  resolveAuthorLabel?: (annotation: Annotation) => string | undefined;
  leaderCombos?: readonly string[];
  onLeaderCommand?: (key: KeyEvent) => void;
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
  resolveAuthorLabel,
  leaderCombos,
  onLeaderCommand,
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
    resolveAuthorLabel,
    leaderCombos,
    onLeaderCommand,
    onExit,
  });
  const { palette, discussions } = surface;
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const { height: terminalHeight } = useTerminalDimensions();
  const viewWidth = useFrameMeasure(
    () => scrollRef.current?.content?.width ?? 0,
    (left, right) => left === right,
    0,
  );

  // only the viewport's blocks (plus an overscan) mount; a block is estimated at its wrapped-line
  // count until its box, cards included, is measured. The initial viewport seeds the first render so a
  // freshly mounted thread (a switch from a diff, another project) windows its first paint rather than
  // building every block, and never flashes blank.
  const estimateBlockRows = (index: number): number => {
    const block = display[index];

    if (!block) return 1;
    const usable = viewWidth > 0 ? Math.max(1, viewWidth - 6) : 40;
    const lines = Math.max(1, Math.ceil(displayText(block).length / usable));

    return lines + (index === 0 ? 0 : 1);
  };
  const virtual = useTerminalVirtualizer({
    scrollbox: scrollRef,
    count: display.length,
    estimateSize: estimateBlockRows,
    overscan: OVERSCAN_BLOCKS,
  });

  useEffect(() => {
    virtual.scrollToIndex(surface.revealBlockIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }

  const lineRowFor = (context: LineContext): React.ReactNode => {
    const { blockIndex, text, line, lineIndex, ranges, marker, baseFg, baseAttributes } = context;
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
        </text>
      </box>
    );
  };

  const blockNodeFor = (blockIndex: number): React.ReactNode => {
    const block = display[blockIndex]!;
    const text = displayText(block);
    const ranges = surface.rangesFor(blockIndex);
    const { baseFg, baseAttributes, marker } = blockStyle(block, tokens);
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

    // the leading gap rides inside the measured box (not marginTop, which sits outside it) so the
    // virtualizer's spacer math counts it
    const leadingGap =
      blockIndex === 0 || tight ? null : <box key="lead-gap" style={{ height: 1 }} />;

    return (
      <box
        key={`discussion-block-${blockIndex}`}
        id={`discussion-block-${blockIndex}`}
        ref={virtual.measureRef(blockIndex)}
        style={{ flexDirection: "column" }}
      >
        {leadingGap}
        {languageRow}
        {lineRows}
      </box>
    );
  };

  const virtualBlocks = (): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    const firstItem = virtual.items[0];
    const lastItem = virtual.items.at(-1);

    // the very first render has no measured viewport yet, so the virtualizer's window is empty; paint a
    // viewport-worth from the top rather than blank or the whole document, then it takes over next frame
    if (!firstItem || !lastItem) {
      let mountedRows = 0;

      for (let index = 0; index < display.length; index++) {
        nodes.push(blockNodeFor(index));
        mountedRows += estimateBlockRows(index);
        if (mountedRows > terminalHeight + OVERSCAN_BLOCKS) break;
      }

      return nodes;
    }
    if (firstItem.start > 0) {
      nodes.push(<box key="spacer-above" style={{ height: firstItem.start }} />);
    }
    for (const item of virtual.items) nodes.push(blockNodeFor(item.index));
    const below = virtual.totalSize - lastItem.end;

    if (below > 0) nodes.push(<box key="spacer-below" style={{ height: below }} />);

    return nodes;
  };

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
        {/* the rail draws this box's scrollbar past the dots, so the built-in one stays hidden */}
        <scrollbox
          ref={scrollRef}
          style={{ flexGrow: 1, paddingTop: 1 }}
          focused={false}
          verticalScrollbarOptions={{ visible: false }}
        >
          {virtualBlocks()}
        </scrollbox>
      </box>
      <DiscussionMarkerRail
        discussions={discussions}
        spanQuote={surface.spanQuote}
        onJump={surface.jumpToDiscussion}
        scrollbox={scrollRef}
        theme={theme}
      />
    </box>
  );
}
