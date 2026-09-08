/**
 * The annotation surface: everything an inline-commenting view shares, over a
 * list of text lines it does not know how to paint. A character-precise caret
 * sits in the text; click/drag marks (word mode on double-click); typing opens a
 * composer anchored at the caret word or held selection; "/" opens the quick-action
 * palette; enter replies, tab folds, esc dismisses; cmd+enter sends. The plan
 * thread view and the diff sheet both drive this hook and only paint their own
 * rows, so marking and commenting behave identically on prose and on code.
 *
 * The view registers one renderable per visual line (so a drag can hit-test any
 * row on screen), asks for the mark ranges to paint on a block, and slots the
 * cards this hook builds under the visual line a span ends on.
 */

import React, { useEffect, useRef, useState } from "react";
import type { KeyEvent, MouseEvent as TerminalMouseEvent, TextRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { ReviewSession } from "@cueloop/schema";
import type { Mark } from "./view-plan";
import type { QuickAction } from "./config";
import type { Theme } from "./theme";
import {
  comparePositions,
  isDoubleClick,
  nextWordStart,
  orderedSpan,
  positionAt,
  previousWordStart,
  snapSpanToWords,
  spanRangeInBlock,
  tightenSpan,
  wordRangeAt,
  type ClickStamp,
  type LineGeometry,
  type TextPosition,
  type TextSpan,
} from "./thread-selection";
import { annotationPaletteFor, type AnnotationPalette } from "./annotation-palette";
import { printableSequence, type MarkRange, type VisualLine } from "./mark-runs";
import { resolveInlineSuggestion, slashFilter, slashItemsFrom } from "./slash-palette";
import { discussionsFrom, type Discussion } from "./discussions";
import {
  CommentRow,
  Composer,
  ComposerPalette,
  DiscussionCard,
  type EdgeSegment,
} from "./components/AnnotationCards";

/** The lines a surface annotates: the text per block and which blocks take a comment. */
export interface LineSource {
  count: number;
  textAt(blockIndex: number): string;
  /** A block the caret can rest on and a comment can anchor to (a diff's header rows cannot). */
  annotatable(blockIndex: number): boolean;
}

export interface ComposeState {
  /** The block the card renders under: where the span ends. */
  blockIndex: number;
  /** Reply target; null composes a new discussion. */
  discussionKey: string | null;
  span: TextSpan | null;
  seed: string;
  /** When set, the composer rewrites this annotation instead of appending. */
  editAnnotationId: string | null;
}

export interface AnnotationSurfaceOptions {
  source: LineSource;
  session: ReviewSession;
  marks: Map<number, Mark[]>;
  quickActions: QuickAction[];
  tokens: Theme;
  observer: boolean;
  /** A verdict is in: no draft may open; the app answers with its read-only status. */
  resolved: boolean;
  /** True while a menu, dialog, or overlay owns the keyboard. */
  suspended: boolean;
  /** Reports whether a composer is open, so session chords can yield to typing. */
  onComposingChange?: (composing: boolean) => void;
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
}

export interface AnnotationSurface {
  palette: AnnotationPalette;
  discussions: Discussion[];
  /** The caret's block. */
  cursor: number;
  head: TextPosition;
  compose: ComposeState | null;
  focusedDiscussion: string | null;
  /** The block to keep in view: an opening card, a focused discussion, else the caret. */
  revealBlockIndex: number;
  /** The text a span covers, blocks joined by a space, for previews. */
  spanQuote: (span: TextSpan) => string;
  /** Ref callback for one visual line, so a drag can hit-test it. */
  registerLine: (
    blockIndex: number,
    lineIndex: number,
    line: VisualLine,
  ) => (renderable: TextRenderable | null) => void;
  /** Press on a visual line: place the caret (word mode on double-click) and start a drag. */
  onLineMouseDown: (event: TerminalMouseEvent) => void;
  /** Drag routing for the view root, so a fast flick off a row never strands the gesture. */
  rootMouseProps: {
    onMouseDrag: (event: TerminalMouseEvent) => void;
    onMouseDragEnd: () => void;
    onMouseUp: () => void;
  };
  /** Ranges to paint on a block: discussion marks, the compose mark, the caret cell. */
  rangesFor: (blockIndex: number) => MarkRange[];
  /** Cards anchored to a visual line: discussion cards, the new-discussion composer, the palette. */
  cardsAfterLine: (blockIndex: number, line: VisualLine, isLastLine: boolean) => React.ReactNode[];
  jumpToDiscussion: (key: string) => void;
  /** Clicking away from an open composer commits the draft. */
  blurSaveCompose: () => void;
}

/** The nearest block the caret can rest on, stepping from `from` in `direction`; `from` when none. */
function nearestAnnotatable(source: LineSource, from: number, direction: 1 | -1): number {
  for (let index = from + direction; index >= 0 && index < source.count; index += direction) {
    if (source.annotatable(index)) return index;
  }

  return from;
}

/** The first block the caret can rest on, so a surface never opens on a header. */
function firstAnnotatable(source: LineSource): number {
  for (let index = 0; index < source.count; index++) if (source.annotatable(index)) return index;

  return 0;
}

export function useAnnotationSurface(options: AnnotationSurfaceOptions): AnnotationSurface {
  const {
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
  } = options;
  const palette = annotationPaletteFor(tokens);
  const discussions = discussionsFrom(session, marks);
  const [cursor, setCursor] = useState(() => firstAnnotatable(source));
  // character-precise: `head` is the caret, `anchor` the other end of a held
  // selection (the same position when collapsed); both are full positions, so
  // the cursor block (cards, folding) can move without conjuring a selection
  const [caret, setCaret] = useState<{ head: TextPosition; anchor: TextPosition }>(() => {
    const start = { blockIndex: firstAnnotatable(source), char: 0 };

    return { head: start, anchor: start };
  });
  const [compose, setCompose] = useState<ComposeState | null>(null);

  useEffect(() => {
    onComposingChange?.(compose !== null);
  }, [compose, onComposingChange]);
  useEffect(() => {
    onCursorChange?.(caret.head.blockIndex);
  }, [caret.head.blockIndex, onCursorChange]);
  // the lines can change under the caret (a diff loads, a file folds): land it on
  // the nearest block it may rest on rather than a header or past the end
  useEffect(() => {
    const { blockIndex } = caret.head;

    if (source.count === 0) return;
    if (blockIndex < source.count && source.annotatable(blockIndex)) return;
    const clamped = Math.min(blockIndex, source.count - 1);
    const next = source.annotatable(clamped)
      ? clamped
      : nearestAnnotatable(source, clamped, 1) !== clamped
        ? nearestAnnotatable(source, clamped, 1)
        : nearestAnnotatable(source, clamped, -1);
    const position = { blockIndex: next, char: 0 };

    setCursor(next);
    setCaret({ head: position, anchor: position });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.count]);

  // discussion focus is the rail's card focus seen from the document: when the
  // app owns it (onFocusAnnotation), the focused discussion is the one holding
  // the focused card and focusing here names the root comment; standalone, it
  // is local state
  const [localFocus, setLocalFocus] = useState<string | null>(null);
  const focusedDiscussion =
    onFocusAnnotation === undefined
      ? localFocus
      : (discussions.find((discussion) =>
          discussion.annotations.some((annotation) => annotation.id === focusedAnnotationId),
        )?.key ?? null);
  const setFocusedDiscussion = (key: string | null): void => {
    if (onFocusAnnotation === undefined) return setLocalFocus(key);
    onFocusAnnotation(discussions.find((discussion) => discussion.key === key)?.rootId);
  };
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [composeText, setComposeText] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const composerReady = useRef(false);
  const composeRef = useRef<ComposeState | null>(null);
  // every visual line registers its renderable so a drag can hit-test any
  // row on screen, across blocks (rows without text resolve to the block above)
  const lineRenderables = useRef(
    new Map<
      string,
      { blockIndex: number; start: number; end: number; renderable: TextRenderable }
    >(),
  );
  // the press anchors the gesture; the first drag samples can land before
  // React has re-rendered, so the anchor travels with the gesture, not the closure
  const dragging = useRef<{ wordMode: boolean; anchor: TextPosition; head: TextPosition } | null>(
    null,
  );
  const lastClick = useRef<ClickStamp | null>(null);

  const blockText = (blockIndex: number): string =>
    blockIndex < source.count ? source.textAt(blockIndex) : "";
  const textLengthOf = (blockIndex: number): number => blockText(blockIndex).length;
  const { head } = caret;
  /** The held selection in document order, off block edges; null when collapsed. */
  const heldSpan = ((): TextSpan | null => {
    const span = orderedSpan({ anchor: caret.anchor, head });

    return span ? tightenSpan(span, textLengthOf) : null;
  })();
  const caretIsSelection = heldSpan !== null;
  /** The typing anchor: the held selection (char-precise), else the marked word. */
  const caretSpan = (): TextSpan | null => {
    if (heldSpan) return heldSpan;
    const word = wordRangeAt(blockText(head.blockIndex), head.char);

    return word
      ? {
          start: { blockIndex: cursor, char: word.start },
          end: { blockIndex: cursor, char: word.end },
        }
      : null;
  };
  const collapseCaret = (): void => setCaret({ head, anchor: head });
  const spanQuote = (span: TextSpan): string => {
    const parts: string[] = [];

    for (let blockIndex = span.start.blockIndex; blockIndex <= span.end.blockIndex; blockIndex++) {
      const range = spanRangeInBlock(span, blockIndex, textLengthOf(blockIndex));

      if (range) parts.push(blockText(blockIndex).slice(range.start, range.end));
    }

    return parts.join(" ");
  };
  const allGeometry = (): LineGeometry[] =>
    [...lineRenderables.current.values()].map((entry) => ({
      blockIndex: entry.blockIndex,
      start: entry.start,
      end: entry.end,
      x: entry.renderable.x,
      y: entry.renderable.y,
    }));

  const openCompose = (state: ComposeState): void => {
    if (observer) return onObserverBlocked?.("observer");
    if (resolved) return onObserverBlocked?.("resolved");
    composerReady.current = false;
    composeRef.current = state;
    setCompose(state);
    setComposeText(state.seed);
    setSlashIndex(0);
  };
  const closeCompose = (): void => {
    composeRef.current = null;
    setCompose(null);
    setComposeText("");
  };
  const slashActive = compose !== null && composeText.startsWith("/");
  const slashItems = slashActive
    ? slashFilter(slashItemsFrom(quickActions), composeText.slice(1).trim())
    : [];
  // inline skill completion: the trailing "/word" token and its closest match,
  // offered as a hint below the composer that tab completes to the full name
  const inlineSlash = resolveInlineSuggestion(slashActive, composeText, quickActions);

  const saveComment = (body: string): void => {
    // the body saves verbatim - typed newlines are the author's choice;
    // trimming only decides whether the draft is empty enough to discard
    const target = composeRef.current;

    closeCompose();
    collapseCaret();
    if (!target || body.trim().length === 0) return;
    if (target.editAnnotationId !== null) {
      onUpdateAnnotation(target.editAnnotationId, body);

      return;
    }
    if (target.discussionKey !== null) {
      const discussion = discussions.find((candidate) => candidate.key === target.discussionKey);

      if (discussion) {
        onReply(discussion.rootId, body);

        return;
      }
    }
    const span = target.span ?? caretSpan();

    if (span) onAnnotate(span, body);
  };
  /** A new discussion on the typing anchor; the card renders under the span's last block. */
  const openNewCompose = (seed: string): void => {
    const span = caretSpan();

    openCompose({
      blockIndex: span?.end.blockIndex ?? head.blockIndex,
      discussionKey: null,
      span,
      seed,
      editAnnotationId: null,
    });
  };

  // clicking away from an open composer commits the draft (blur-save);
  // a half-typed slash query is never a comment, so it discards instead
  const blurSaveCompose = (): void => {
    if (!composeRef.current) return;
    if (slashActive || composeText.trim().length === 0) return closeCompose();
    saveComment(composeText);
  };

  /** Extend the held selection to the pointer's position (word mode snaps both ends). */
  const extendSelectionTo = (pointer: TextPosition): void => {
    const drag = dragging.current;

    if (!drag) return;
    let next = { head: pointer, anchor: drag.anchor };

    if (drag.wordMode) {
      const span = orderedSpan({ anchor: drag.anchor, head: pointer });

      if (span) {
        const snapped = snapSpanToWords(span, blockText);
        const forward = comparePositions(pointer, drag.anchor) >= 0;

        next = forward
          ? { anchor: snapped.start, head: snapped.end }
          : { anchor: snapped.end, head: snapped.start };
      }
    }
    if (comparePositions(next.head, drag.head) === 0) return;
    drag.head = next.head;
    setCursor(next.head.blockIndex);
    setCaret({ head: next.head, anchor: next.anchor });
  };

  // Drag routing lives on the view root: the renderer captures the drag on
  // its FIRST drag sample, to whatever is under the pointer then, so a fast
  // flick off the text row would otherwise strand the gesture. Events
  // bubble, so the root sees every drag and resolves it against every line
  // on screen - the mark follows the pointer across blocks.
  const handleRootDrag = (event: TerminalMouseEvent): void => {
    if (!dragging.current) return;
    const position = positionAt(allGeometry(), event.x, event.y);

    if (position) extendSelectionTo(position);
  };
  const endDrag = (): void => {
    dragging.current = null;
  };

  const jumpToDiscussion = (key: string): void => {
    const target = discussions.find((discussion) => discussion.key === key);

    if (!target) return;
    blurSaveCompose();
    setCursor(target.blockIndex);
    setFocusedDiscussion(key);
  };

  // ── keyboard, split per concern to stay within the complexity budget ──

  const handleSlashKey = (key: KeyEvent, activeCompose: ComposeState): boolean => {
    if (!slashActive || slashItems.length === 0) return false;
    const selected = Math.min(slashIndex, slashItems.length - 1);

    if (key.name === "up") {
      setSlashIndex(Math.max(0, selected - 1));

      return true;
    }
    if (key.name === "down") {
      setSlashIndex(Math.min(slashItems.length - 1, selected + 1));

      return true;
    }
    if (key.name === "return" || key.name === "tab") {
      openCompose({ ...activeCompose, seed: slashItems[selected]!.body });

      return true;
    }

    return false;
  };

  /** Tab completes the trailing "/word" to the matched skill's full name, then a space to chain. */
  const handleInlineSlashKey = (key: KeyEvent, activeCompose: ComposeState): boolean => {
    if (inlineSlash === null || key.name !== "tab") return false;
    const cut = composeText.length - inlineSlash.token.length;
    const completed = `${composeText.slice(0, cut)}/${inlineSlash.suggestion.name} `;

    openCompose({ ...activeCompose, seed: completed });

    return true;
  };

  /** Pre-mount window: buffer printables, honor a fast cmd+enter or newline. */
  const handlePremountKey = (key: KeyEvent, activeCompose: ComposeState): void => {
    if (key.name === "return") {
      if (key.super || key.meta || key.ctrl) return saveComment(activeCompose.seed);
      const grown = { ...activeCompose, seed: `${activeCompose.seed}\n` };

      composeRef.current = grown;
      setComposeText(grown.seed);

      return setCompose(grown);
    }
    const sequence = printableSequence(key);

    if (sequence) {
      const grown = { ...activeCompose, seed: activeCompose.seed + sequence };

      composeRef.current = grown;
      setComposeText(grown.seed);
      setCompose(grown);
    }
  };

  const handleComposeKey = (key: KeyEvent, activeCompose: ComposeState): void => {
    // the textarea owns every key while open; the view takes dismiss (which
    // also releases the discussion focus), the slash palette, and pre-mount input
    if (key.name === "escape") {
      setFocusedDiscussion(null);

      return closeCompose();
    }
    // backspace on an already empty draft undoes it: the card dissolves
    // and the caret sits back on the still-held selection, ready to re-type
    // (an edit of an existing comment is never deleted this way)
    if (
      key.name === "backspace" &&
      composeText.length === 0 &&
      activeCompose.editAnnotationId === null
    ) {
      return closeCompose();
    }
    if (handleSlashKey(key, activeCompose)) return;
    if (handleInlineSlashKey(key, activeCompose)) return;
    if (!composerReady.current) handlePremountKey(key, activeCompose);
  };

  /** m / cmd+[ / cmd+] / tab / return - true when the key was a discussion primitive. */
  const handleDiscussionVerb = (key: KeyEvent): boolean => {
    // comment on selection: cmd+option+m (alt+m where cmd arrives ESC-prefixed)
    if (key.name === "m" && (key.super || key.meta || key.option)) {
      openNewCompose("");

      return true;
    }
    if ((key.super || key.meta || key.ctrl) && (key.name === "[" || key.name === "]")) {
      if (discussions.length === 0) return true;
      const currentIndex = discussions.findIndex(
        (discussion) => discussion.key === focusedDiscussion,
      );
      const nextIndex =
        key.name === "]"
          ? (currentIndex + 1) % discussions.length
          : currentIndex <= 0
            ? discussions.length - 1
            : currentIndex - 1;

      jumpToDiscussion(discussions[nextIndex]!.key);

      return true;
    }
    if (key.name === "tab") {
      setFolded((current) => {
        const next = new Set(current);

        for (const discussion of discussions) {
          if (discussion.blockIndex !== cursor) continue;
          if (next.has(discussion.key)) next.delete(discussion.key);
          else next.add(discussion.key);
        }

        return next;
      });

      return true;
    }
    // enter replies into the focused discussion, else the cursor block's discussion
    if (key.name === "return") {
      const replyTarget =
        discussions.find((discussion) => discussion.key === focusedDiscussion) ??
        discussions.findLast((discussion) => discussion.blockIndex === cursor);

      if (replyTarget) {
        openCompose({
          blockIndex: replyTarget.blockIndex,
          discussionKey: replyTarget.key,
          span: null,
          seed: "",
          editAnnotationId: null,
        });
      }

      return true;
    }

    return false;
  };

  /** Arrows step by word start; shift holds the anchor; the caret flows across blocks. */
  const moveCaretHorizontal = (delta: 1 | -1, extend: boolean): void => {
    const text = blockText(head.blockIndex);
    const target =
      delta === 1 ? nextWordStart(text, head.char) : previousWordStart(text, head.char);
    const moveTo = (blockIndex: number, char: number): void => {
      const next = { blockIndex, char };

      setCursor(blockIndex);
      setCaret({ head: next, anchor: extend ? caret.anchor : next });
    };

    if (target !== null) return moveTo(head.blockIndex, target);
    if (extend && head.char !== (delta === 1 ? text.length : 0)) {
      // the block edge first, then the next step crosses into the neighbour
      return moveTo(head.blockIndex, delta === 1 ? text.length : 0);
    }
    // the neighbour is the next block the caret may rest on: headers are skipped
    const neighbour = nearestAnnotatable(source, head.blockIndex, delta);

    if (neighbour === head.blockIndex) return;
    if (delta === 1) return moveTo(neighbour, 0);
    const previousText = blockText(neighbour);

    moveTo(
      neighbour,
      extend ? previousText.length : (previousWordStart(previousText, previousText.length) ?? 0),
    );
  };

  const handleCaretKey = (key: KeyEvent): boolean => {
    const vertical =
      key.name === "up" || (key.ctrl && key.name === "p")
        ? -1
        : key.name === "down" || (key.ctrl && key.name === "n")
          ? 1
          : 0;

    if (vertical !== 0) {
      const next = nearestAnnotatable(source, cursor, vertical);

      setCaret({
        head: { blockIndex: next, char: 0 },
        anchor: { blockIndex: next, char: 0 },
      });
      setFocusedDiscussion(null);
      setCursor(next);

      return true;
    }
    if (key.name === "right" || (key.ctrl && key.name === "l")) {
      moveCaretHorizontal(1, Boolean(key.shift || key.meta || key.ctrl));

      return true;
    }
    if (key.name === "left" || (key.ctrl && key.name === "h")) {
      moveCaretHorizontal(-1, Boolean(key.shift || key.meta || key.ctrl));

      return true;
    }

    return false;
  };

  /** A printable starts a comment: edit my trailing, reply, or a new discussion. */
  const startTyping = (key: KeyEvent): void => {
    const sequence = printableSequence(key);

    if (!sequence) return;
    const discussion = discussions.find((candidate) => candidate.key === focusedDiscussion);

    if (discussion) {
      const last = discussion.annotations.at(-1)!;
      const editingOwn = last.author === undefined;

      return openCompose({
        blockIndex: discussion.blockIndex,
        discussionKey: discussion.key,
        span: null,
        seed: editingOwn ? `${last.body}${sequence}` : sequence,
        editAnnotationId: editingOwn ? last.id : null,
      });
    }
    openNewCompose(sequence);
  };

  useKeyboard((key) => {
    if (suspended) return;
    if (key.ctrl && key.name === "q") return onExit();
    const activeCompose = composeRef.current;

    if (activeCompose) return handleComposeKey(key, activeCompose);
    if (key.name === "escape") {
      if (focusedDiscussion !== null) return setFocusedDiscussion(null);

      return collapseCaret();
    }
    if (handleDiscussionVerb(key)) return;
    if (handleCaretKey(key)) return;
    startTyping(key);
  });

  // ── the cards the view slots under its lines ──

  // one composer element (keyed by seed so slash acceptance remounts it);
  // the slash palette renders BELOW the whole card, not inside it
  const composerNode = compose ? (
    <Composer
      key={compose.seed}
      seed={compose.seed}
      glyph="●"
      tokens={tokens}
      onSave={saveComment}
      onReady={() => (composerReady.current = true)}
      onInput={setComposeText}
    />
  ) : null;
  // one node below the composer: the palette list for a leading "/", otherwise the
  // inline completion hint. Renders null when neither applies, so it always pushes.
  const paletteNode = (
    <ComposerPalette
      key="composer-palette"
      slashActive={slashActive}
      slashItems={slashItems}
      slashIndex={slashIndex}
      inline={inlineSlash}
      tokens={tokens}
    />
  );

  const foldedSummaryFor = (discussion: Discussion): React.ReactNode => (
    <box key={discussion.key} style={{ flexDirection: "row", marginTop: 1, marginLeft: 2 }}>
      <text fg={tokens.textDim}>
        {`○ ${discussion.annotations.length} comment${discussion.annotations.length === 1 ? "" : "s"} ›`}
      </text>
    </box>
  );

  const discussionCardFor = (discussion: Discussion, composingHere: boolean): React.ReactNode => {
    const segments: EdgeSegment[] = discussion.annotations.map((annotation) => {
      const editingHere =
        composingHere && compose?.editAnnotationId === annotation.id && composerNode !== null;

      return {
        color: annotation.author === undefined ? palette.cardEdge : tokens.text,
        node: editingHere ? (
          composerNode
        ) : (
          <CommentRow key={annotation.id} annotation={annotation} tokens={tokens} />
        ),
      };
    });

    if (composingHere && compose?.editAnnotationId === null && composerNode) {
      segments.push({ color: palette.cardEdge, node: composerNode });
    }

    return (
      <DiscussionCard
        key={discussion.key}
        segments={segments}
        tokens={tokens}
        focused={focusedDiscussion === discussion.key}
        onFocus={() => {
          if (composeRef.current?.discussionKey === discussion.key) return;
          blurSaveCompose();
          setFocusedDiscussion(discussion.key);
          setCursor(discussion.blockIndex);
        }}
      />
    );
  };

  const rangesFor = (blockIndex: number): MarkRange[] => {
    const textLength = textLengthOf(blockIndex);
    const ranges: MarkRange[] = [];
    const pushSpan = (span: TextSpan | null): void => {
      const range = span ? spanRangeInBlock(span, blockIndex, textLength) : null;

      if (range) ranges.push(range);
    };

    for (const discussion of discussions) pushSpan(discussion.span);
    if (compose) pushSpan(compose.span);
    if (caretIsSelection && !compose) pushSpan(heldSpan);
    // the idle caret cell sits at the head, also at the end of a held mark;
    // an open card takes the cursor with it, so no cell is painted then
    if (blockIndex === head.blockIndex && !compose && textLength > 0) {
      const cell = Math.max(0, Math.min(textLength - 1, head.char));

      ranges.push({ start: cell, end: cell + 1, caretOnly: true });
    }

    return ranges;
  };

  const cardsAfterLine = (
    blockIndex: number,
    line: VisualLine,
    isLastLine: boolean,
  ): React.ReactNode[] => {
    const endsInLine = (end: number): boolean => end - 1 >= line.start && end - 1 < line.end;
    const nodes: React.ReactNode[] = [];
    const composeHere = compose && compose.blockIndex === blockIndex;

    for (const discussion of discussions) {
      if (discussion.blockIndex !== blockIndex || !endsInLine(discussion.span.end.char)) continue;
      const composingHere = Boolean(composeHere && compose.discussionKey === discussion.key);

      if (folded.has(discussion.key) && !composingHere) {
        nodes.push(foldedSummaryFor(discussion));
        continue;
      }
      nodes.push(discussionCardFor(discussion, composingHere));
      if (composingHere) nodes.push(paletteNode);
    }
    if (composeHere && compose.discussionKey === null && composerNode) {
      const anchoredHere = compose.span ? endsInLine(compose.span.end.char) : isLastLine;

      if (anchoredHere) {
        nodes.push(
          <DiscussionCard
            key="compose-new"
            tokens={tokens}
            segments={[{ color: palette.cardEdge, node: composerNode }]}
          />,
        );
        nodes.push(paletteNode);
      }
    }

    return nodes;
  };

  const registerLine =
    (blockIndex: number, lineIndex: number, line: VisualLine) =>
    (renderable: TextRenderable | null): void => {
      const key = `${blockIndex}:${lineIndex}`;

      if (renderable) {
        lineRenderables.current.set(key, {
          blockIndex,
          start: line.start,
          end: line.end,
          renderable,
        });
      } else lineRenderables.current.delete(key);
    };

  const onLineMouseDown = (event: TerminalMouseEvent): void => {
    blurSaveCompose();
    const pressed = positionAt(allGeometry(), event.x, event.y);

    if (!pressed || !source.annotatable(pressed.blockIndex)) return;
    const stamp = { time: Date.now(), x: event.x, y: event.y };
    const wordMode = isDoubleClick(lastClick.current, stamp);

    lastClick.current = stamp;
    const word = wordMode ? wordRangeAt(blockText(pressed.blockIndex), pressed.char) : null;
    const anchor = word ? { blockIndex: pressed.blockIndex, char: word.start } : pressed;
    const pressHead = word ? { blockIndex: pressed.blockIndex, char: word.end } : pressed;

    dragging.current = { wordMode, anchor, head: pressHead };
    setFocusedDiscussion(null);
    setCursor(pressed.blockIndex);
    setCaret({ head: pressHead, anchor });
  };

  // an opening card shifts the layout, so the block it belongs to is revealed
  // again; a discussion focused from the rail is scrolled into view the same way
  const revealBlockIndex =
    compose?.blockIndex ??
    discussions.find((discussion) => discussion.key === focusedDiscussion)?.blockIndex ??
    cursor;

  return {
    palette,
    discussions,
    cursor,
    head,
    compose,
    focusedDiscussion,
    revealBlockIndex,
    spanQuote,
    registerLine,
    onLineMouseDown,
    rootMouseProps: { onMouseDrag: handleRootDrag, onMouseDragEnd: endDrag, onMouseUp: endDrag },
    rangesFor,
    cardsAfterLine,
    jumpToDiscussion,
    blurSaveCompose,
  };
}
