/**
 * The annotation surface: everything an inline-commenting view shares, over a
 * list of text lines it does not know how to paint. A character-precise caret
 * sits in the text; click/drag marks (word mode on double-click); typing opens a
 * composer anchored at the caret word or held selection; "/" opens the quick-action
 * palette; enter replies, tab folds, esc dismisses; Option+Enter saves, Ctrl+Enter invokes. The plan
 * thread view and the diff sheet both drive this hook and only paint their own
 * rows, so marking and commenting behave identically on prose and on code.
 *
 * The view registers one renderable per visual line (so a drag can hit-test any
 * row on screen), asks for the mark ranges to paint on a block, and slots the
 * cards this hook builds under the visual line a span ends on.
 */

import React, { useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import type { KeyEvent, MouseEvent as TerminalMouseEvent, TextRenderable } from "@opentui/core";
import { flushSync } from "@opentui/react";
import { useSharedKeyboard } from "../keyboard/use-shared-keyboard";
import { agentInputTarget, type Annotation, type Thread } from "@cueloop/schema";
import type { Mark } from "../markdown/view-plan";
import type { QuickAction } from "../settings/config";
import type { Theme } from "../appearance/theme";
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
import { printableSequence, type MarkRange, type VisualLine } from "../markdown/mark-runs";
import {
  activeSlashToken,
  insertSlashItem,
  isStandaloneSlashQuery,
  mergeSlashItems,
  slashFilter,
  slashItemsFrom,
} from "../keyboard/slash-palette";
import { SlashSkillsContext } from "../keyboard/skills";
import { discussionsFrom, spanKey, type Discussion } from "./discussions";
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
  annotatable(blockIndex: number): boolean;
}

/** Prompt drafts cannot carry a discussion or edit target; comment drafts retain those targets. */
export type ComposeState = { blockIndex: number; seed: string } & (
  | { kind: "prompt"; discussionKey: null; editAnnotationId: null; span: TextSpan }
  | {
      kind: "comment";
      discussionKey: string | null;
      editAnnotationId: string | null;
      span: TextSpan | null;
    }
);

/** A completed reply requests an empty continuation prompt once per reply ID. */
export interface PromptFocusRequest {
  replyId: string;
  blockIndex: number;
}

/** Rejected prompt text returns to the visible composer once per request. */
export interface PromptRestoreRequest {
  id: number;
  text: string;
}

export interface AnnotationSurfaceOptions {
  source: LineSource;
  session: Thread;
  marks: Map<number, Mark[]>;
  quickActions: QuickAction[];
  tokens: Theme;
  observer: boolean;
  commentsEnabled?: boolean;
  resolved: boolean;
  suspended: boolean;
  onComposingChange?: (composing: boolean) => void;
  onObserverBlocked?: (reason: "observer" | "resolved") => void;
  onCursorChange?: (blockIndex: number) => void;
  onVerticalStep?: (
    fromBlock: number,
    toBlock: number,
    direction: -1 | 1,
    targetY?: number,
  ) => boolean;
  focusedAnnotationId?: string;
  onFocusAnnotation?: (annotationId: string | undefined) => void;
  onAnnotate: (span: TextSpan, body: string) => string | void;
  onReply: (rootAnnotationId: string, body: string) => string | void;
  onUpdateAnnotation: (id: string, body: string) => void;
  isAnnotationReadOnly?: (id: string) => boolean;
  annotationAction?: (id: string) => { label: string; run: () => void } | undefined;
  requestedBlock?: { blockIndex: number };
  onInvoke?: (commentId?: string) => void;
  isPromptBlock?: (blockIndex: number) => boolean;
  promptFocusRequest?: PromptFocusRequest;
  promptRestoreRequest?: PromptRestoreRequest;
  dragViewport?: () => {
    top: number;
    bottom: number;
    scrollBy: (rows: -1 | 1) => boolean;
  } | null;
  resolveAuthorLabel?: (annotation: Annotation) => string | undefined;
  onNavCommand?: (key: KeyEvent, selection: TextSpan | null) => boolean;
  onExit: () => void;
}

export interface AnnotationSurface {
  palette: AnnotationPalette;
  discussions: Discussion[];
  cursor: number;
  head: TextPosition;
  compose: ComposeState | null;
  navMode: boolean;
  focusedDiscussion: string | null;
  revealBlockIndex: number;
  headVisualY: () => number | undefined;
  prepareViewportScroll: () => (delta: number, top: number, bottom: number) => void;
  spanQuote: (span: TextSpan) => string;
  registerLine: (
    blockIndex: number,
    lineIndex: number,
    line: VisualLine,
  ) => (renderable: TextRenderable | null) => void;
  onLineMouseDown: (event: TerminalMouseEvent) => void;
  rootMouseProps: {
    onMouseDown: (event: TerminalMouseEvent) => void;
    onMouseDrag: (event: TerminalMouseEvent) => void;
    onMouseDragEnd: () => void;
    onMouseUp: () => void;
  };
  rangesFor: (blockIndex: number) => MarkRange[];
  cardsAfterLine: (blockIndex: number, line: VisualLine, isLastLine: boolean) => React.ReactNode[];
  jumpToDiscussion: (key: string) => void;
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

/** The visual-row direction requested by an arrow or readline-style caret key. */
function verticalCaretDelta(key: KeyEvent): -1 | 0 | 1 {
  if (key.name === "up" || (key.ctrl && key.name === "p")) return -1;
  if (key.name === "down" || (key.ctrl && key.name === "n")) return 1;

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
    commentsEnabled = true,
    resolved,
    suspended,
    onComposingChange,
    onObserverBlocked,
    onCursorChange,
    onVerticalStep,
    focusedAnnotationId,
    onFocusAnnotation,
    onAnnotate,
    onReply,
    onUpdateAnnotation,
    isAnnotationReadOnly,
    annotationAction,
    requestedBlock,
    onInvoke,
    isPromptBlock,
    promptFocusRequest,
    promptRestoreRequest,
    dragViewport,
    resolveAuthorLabel,
    onNavCommand,
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
  const focusRequested = useEffectEvent(() => onFocusAnnotation?.(undefined));

  useEffect(() => {
    if (requestedBlock === undefined) return;
    const next = { blockIndex: requestedBlock.blockIndex, char: 0 };

    setCursor(requestedBlock.blockIndex);
    setCaret({ head: next, anchor: next });
    focusRequested();
  }, [requestedBlock]);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const dragPointer = useRef<{ x: number; y: number } | null>(null);
  const edgeScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragViewportRef = useRef(dragViewport);

  dragViewportRef.current = dragViewport;
  const [navMode, setNavModeState] = useState(false);
  const navModeRef = useRef(false);
  const setNavMode = (value: boolean): void => {
    navModeRef.current = value;
    setNavModeState(value);
  };

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
  const [localFocus, setLocalFocus] = useState<{ key: string; annotationId?: string } | null>(null);
  const getFocusedDiscussion = (): string | null => {
    if (onFocusAnnotation === undefined) return localFocus?.key ?? null;

    return (
      discussions.find((discussion) =>
        discussion.annotations.some((annotation) => annotation.id === focusedAnnotationId),
      )?.key ?? null
    );
  };
  const focusedDiscussion = getFocusedDiscussion();
  const setFocusedDiscussion = (key: string | null): void => {
    if (onFocusAnnotation === undefined) return setLocalFocus(key === null ? null : { key });
    onFocusAnnotation(discussions.find((discussion) => discussion.key === key)?.rootId);
  };
  const focusSavedComment = (annotationId: string, key: string): void => {
    if (onFocusAnnotation) onFocusAnnotation(annotationId);
    else setLocalFocus({ key, annotationId });
  };
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [composeText, setComposeText] = useState("");
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const composeTextRef = useRef("");
  const setDraft = (text: string): void => {
    composeTextRef.current = text;
    setComposeText(text);
  };
  const [caretOffset, setCaretOffset] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const composerReady = useRef(false);
  const readComposerText = useRef<(() => string) | null>(null);
  const composeRef = useRef<ComposeState | null>(null);
  const promptDraft = useRef("");
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
  /** Agent comments require a held selection; legacy surfaces may use the caret word. */
  const caretSpan = (): TextSpan | null => {
    if (heldSpan) return heldSpan;
    if (onInvoke) return isPromptBlock?.(head.blockIndex) ? { start: head, end: head } : null;
    const word = wordRangeAt(blockText(head.blockIndex), head.char);

    return word
      ? {
          start: { blockIndex: cursor, char: word.start },
          end: { blockIndex: cursor, char: word.end },
        }
      : blockText(head.blockIndex).length === 0
        ? { start: head, end: head }
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
  const headVisualY = (): number | undefined => {
    const textLength = textLengthOf(head.blockIndex);
    const cell = Math.max(0, Math.min(textLength - 1, head.char));

    return allGeometry().find(
      (line) =>
        line.blockIndex === head.blockIndex &&
        line.start <= cell &&
        (cell < line.end || line.start === line.end),
    )?.y;
  };
  const prepareViewportScroll = (): ((delta: number, top: number, bottom: number) => void) => {
    const lines = allGeometry().filter((line) => source.annotatable(line.blockIndex));
    const oldHeadY = headVisualY();

    return (delta, top, bottom) => {
      if (delta === 0 || oldHeadY === undefined || compose || focusedDiscussion || caretIsSelection)
        return;
      const shiftedHeadY = oldHeadY - delta;

      if (shiftedHeadY >= top && shiftedHeadY <= bottom) return;
      const visible = lines
        .filter((line) => line.y - delta >= top && line.y - delta <= bottom)
        .toSorted((left, right) => left.y - right.y || left.x - right.x);
      const target = delta < 0 ? visible.at(-1) : visible[0];

      if (!target) return;
      const next = { blockIndex: target.blockIndex, char: target.start };

      flushSync(() => {
        setCaret({ head: next, anchor: next });
        setCursor(next.blockIndex);
      });
    };
  };
  const verticalTextPosition = (
    position: TextPosition,
    direction: -1 | 1,
  ): { position: TextPosition; y: number } | null => {
    const textLength = textLengthOf(position.blockIndex);
    const cell = Math.max(0, Math.min(textLength - 1, position.char));
    const lines = allGeometry()
      .filter((line) => source.annotatable(line.blockIndex))
      .toSorted((left, right) => left.y - right.y || left.x - right.x);
    const currentIndex = lines.findIndex(
      (line) =>
        line.blockIndex === position.blockIndex &&
        line.start <= cell &&
        (cell < line.end || line.start === line.end),
    );
    const target = currentIndex === -1 ? undefined : lines[currentIndex + direction];

    if (!target) return null;
    const current = lines[currentIndex]!;
    const column = Math.max(0, position.char - current.start);

    return {
      position: {
        blockIndex: target.blockIndex,
        char: Math.min(target.end, target.start + column),
      },
      y: target.y,
    };
  };

  const openCompose = (state: ComposeState): void => {
    // a view-only surface (a non-diff thread's live diff) never opens a draft
    if (!commentsEnabled) return;
    if (observer) return onObserverBlocked?.("observer");
    if (resolved) return onObserverBlocked?.("resolved");
    composerReady.current = false;
    readComposerText.current = null;
    composeRef.current = state;
    setCompose(state);
    setComposerFocusRequest((request) => request + 1);
    setDraft(state.seed);
    setCaretOffset(state.seed.length);
    setSlashIndex(0);
  };
  const closeCompose = (): void => {
    composeRef.current = null;
    readComposerText.current = null;
    setCompose(null);
    setDraft("");
    setCaretOffset(0);
  };
  const skills = useContext(SlashSkillsContext);
  const paletteItems = mergeSlashItems(slashItemsFrom(quickActions), skills);
  // the "/word" under the caret, anywhere in the draft, so each new "/" reopens the palette
  const slashToken = compose !== null ? activeSlashToken(composeText, caretOffset) : null;
  const slashActive = slashToken !== null;
  const slashItems = slashToken !== null ? slashFilter(paletteItems, slashToken.slice(1)) : [];

  // a fresh token starts its selection at the top, so an earlier Down never leaks into it
  useEffect(() => {
    if (slashActive) setSlashIndex(0);
  }, [slashActive]);

  const saveComment = (body: string, invoke = false): void => {
    // the body saves verbatim - typed newlines are the author's choice;
    // trimming only decides whether the draft is empty enough to discard
    const target = composeRef.current;
    const prompt = target?.kind === "prompt";

    if (prompt && !invoke) return;
    closeCompose();
    collapseCaret();
    if (!target || body.trim().length === 0) return;
    if (target.editAnnotationId !== null) {
      onUpdateAnnotation(target.editAnnotationId, body);
      if (target.discussionKey) focusSavedComment(target.editAnnotationId, target.discussionKey);
      if (invoke) onInvoke?.(target.editAnnotationId);

      return;
    }
    if (target.discussionKey !== null) {
      const discussion = discussions.find((candidate) => candidate.key === target.discussionKey);

      if (discussion) {
        const commentId = onReply(discussion.rootId, body);

        if (commentId) focusSavedComment(commentId, discussion.key);
        if (invoke && commentId) onInvoke?.(commentId);

        return;
      }
    }
    const span = target.span ?? caretSpan();

    if (span) {
      const commentId = onAnnotate(span, body);

      completeSavedComment(span, commentId, prompt, invoke);
    }
  };
  const completeSavedComment = (
    span: TextSpan,
    commentId: string | void,
    prompt: boolean,
    invoke: boolean,
  ): void => {
    if (!prompt && commentId) {
      focusSavedComment(commentId, spanKey(span));
    }
    if (invoke && (prompt || commentId)) onInvoke?.(commentId || undefined);
  };
  /** A new discussion on the typing anchor; the card renders under the span's last block. */
  const openNewCompose = (seed: string): void => {
    const span = caretSpan();

    if (
      onInvoke &&
      agentInputTarget(Boolean(isPromptBlock?.(head.blockIndex)), Boolean(heldSpan)) === "none"
    )
      return;
    if (isPromptBlock?.(head.blockIndex) && span) {
      openCompose({
        kind: "prompt",
        blockIndex: head.blockIndex,
        discussionKey: null,
        span,
        seed: promptDraft.current + seed,
        editAnnotationId: null,
      });
    } else {
      openCompose({
        kind: "comment",
        blockIndex: span?.end.blockIndex ?? head.blockIndex,
        discussionKey: null,
        span,
        seed,
        editAnnotationId: null,
      });
    }
    if (isPromptBlock?.(head.blockIndex)) promptDraft.current = "";
  };

  // clicking away commits the draft (blur-save); only a standalone "/query" is a palette
  // artifact, so prose that merely ends in a "/name" still saves
  const blurSaveCompose = (): void => {
    const target = composeRef.current;

    if (!target) return;
    if (target.kind === "prompt") {
      promptDraft.current = composeTextRef.current;

      return closeCompose();
    }
    if (isStandaloneSlashQuery(composeText) || composeText.trim().length === 0) {
      return closeCompose();
    }
    saveComment(composeText, false);
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
    dragPointer.current = { x: event.x, y: event.y };
    const position = positionAt(allGeometry(), event.x, event.y);

    if (position) extendSelectionTo(position);
    if (edgeScrollTimer.current === null) {
      edgeScrollTimer.current = setInterval(() => {
        const pointer = dragPointer.current;
        const viewport = dragViewportRef.current?.();

        if (!dragging.current || !pointer || !viewport) return;
        const direction = pointer.y <= viewport.top ? -1 : pointer.y >= viewport.bottom ? 1 : 0;

        if (direction === 0 || !viewport.scrollBy(direction)) return;
        const next = positionAt(allGeometry(), pointer.x, pointer.y);

        if (next) extendSelectionTo(next);
      }, 100);
    }
  };
  const endDrag = (): void => {
    dragging.current = null;
    dragPointer.current = null;
    if (edgeScrollTimer.current !== null) clearInterval(edgeScrollTimer.current);
    edgeScrollTimer.current = null;
  };

  useEffect(() => endDrag, []);

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
      const inserted = insertSlashItem(composeText, caretOffset, slashItems[selected]!.name);

      openCompose({ ...activeCompose, seed: inserted.text });
      setCaretOffset(inserted.caret);

      return true;
    }

    return false;
  };

  /** Pre-mount window: buffer printables, honor a fast comment save, agent invocation, or newline. */
  const handlePremountKey = (key: KeyEvent, activeCompose: ComposeState): void => {
    if (key.name === "return") {
      if (key.super && onInvoke) return;
      if (key.meta || key.ctrl || key.super)
        return saveComment(activeCompose.seed, isAgentInvokeKey(key, onInvoke));
      const grown = { ...activeCompose, seed: `${activeCompose.seed}\n` };

      composeRef.current = grown;
      setDraft(grown.seed);
      setCaretOffset(grown.seed.length);

      return setCompose(grown);
    }
    const sequence = printableSequence(key);

    if (sequence) {
      const grown = { ...activeCompose, seed: activeCompose.seed + sequence };

      composeRef.current = grown;
      setDraft(grown.seed);
      setCaretOffset(grown.seed.length);
      setCompose(grown);
    }
  };

  const handleComposeKey = (key: KeyEvent, activeCompose: ComposeState): void => {
    if (onInvoke && (key.name === "return" || key.name === "enter") && key.super) {
      key.preventDefault();

      return;
    }
    if (isAgentInvokeKey(key, onInvoke)) {
      key.preventDefault();

      return saveComment(readComposerText.current?.() ?? activeCompose.seed, true);
    }
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
      composeTextRef.current.length === 0 &&
      activeCompose.editAnnotationId === null
    ) {
      return closeCompose();
    }
    if (handleSlashKey(key, activeCompose)) return;
    if (!composerReady.current) handlePremountKey(key, activeCompose);
  };

  /** Fold or unfold every discussion sitting on the caret's block (nav-mode z). */
  const toggleFoldAtCursor = (): void => {
    setFolded((current) => {
      const next = new Set(current);

      for (const discussion of discussions) {
        if (discussion.blockIndex !== cursor) continue;
        if (next.has(discussion.key)) next.delete(discussion.key);
        else next.add(discussion.key);
      }

      return next;
    });
  };

  /** m / cmd+[ / cmd+] / return - true when the key was a discussion primitive. */
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
    // enter replies into the focused discussion, else the cursor block's discussion
    if (key.name === "return") {
      const replyTarget =
        discussions.find((discussion) => discussion.key === focusedDiscussion) ??
        discussions.findLast((discussion) => discussion.blockIndex === cursor);

      if (replyTarget) {
        openCompose({
          kind: "comment",
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

  const moveCaretVertical = (key: KeyEvent, vertical: -1 | 1): void => {
    const nextBlock = nearestAnnotatable(source, cursor, vertical);
    const visualTarget = verticalTextPosition(head, vertical);

    if (!visualTarget && nextBlock === head.blockIndex) return;
    const nextHead = visualTarget?.position ?? {
      blockIndex: nextBlock,
      char: key.shift ? Math.min(head.char, textLengthOf(nextBlock)) : 0,
    };

    if (onVerticalStep?.(head.blockIndex, nextHead.blockIndex, vertical, visualTarget?.y)) return;

    setCaret({
      head: nextHead,
      anchor: key.shift ? caret.anchor : nextHead,
    });
    setFocusedDiscussion(null);
    setCursor(nextHead.blockIndex);
  };

  const handleCaretKey = (key: KeyEvent): boolean => {
    const vertical = verticalCaretDelta(key);

    if (vertical !== 0) {
      moveCaretVertical(key, vertical);

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
      const editingOwn = last.author === undefined && !isAnnotationReadOnly?.(last.id);

      return openCompose({
        kind: "comment",
        blockIndex: discussion.blockIndex,
        discussionKey: discussion.key,
        span: null,
        seed: editingOwn ? `${last.body}${sequence}` : sequence,
        editAnnotationId: editingOwn ? last.id : null,
      });
    }
    openNewCompose(sequence);
  };

  const invokeFocusedComment = (): void => {
    const discussion = discussions.find((candidate) => candidate.key === focusedDiscussion);
    const focusedCommentId = focusedAnnotationId ?? localFocus?.annotationId;
    const commentId =
      discussion?.annotations.find((annotation) => annotation.id === focusedCommentId)?.id ??
      discussion?.annotations.at(-1)?.id;

    onInvoke?.(commentId);
  };

  useSharedKeyboard((key) => {
    if (suspended) return;
    if (key.ctrl && key.name === "q") return onExit();
    const activeCompose = composeRef.current;

    if (activeCompose) return handleComposeKey(key, activeCompose);
    if (isAgentInvokeKey(key, onInvoke)) {
      key.preventDefault();

      return invokeFocusedComment();
    }
    if (key.name === "escape") {
      // from type mode esc only enters nav, so a held mark survives for `c`
      if (!navModeRef.current) return setNavMode(true);
      if (focusedDiscussion !== null) setFocusedDiscussion(null);

      return collapseCaret();
    }
    if (navModeRef.current) {
      if (handleCaretKey(key)) return;
      if (key.name === "z") return toggleFoldAtCursor();
      if (onNavCommand?.(key, heldSpan)) return;
      if (key.name === "c") {
        setNavMode(false);

        return openNewCompose("");
      }
      if (printableSequence(key)) {
        setNavMode(false);
        startTyping(key);
      }

      return;
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
      glyph={compose.kind === "prompt" ? null : "●"}
      tokens={tokens}
      onSave={saveComment}
      agentEnabled={Boolean(onInvoke)}
      focusRequest={composerFocusRequest}
      onReady={(readText) => {
        readComposerText.current = readText;
        composerReady.current = true;
      }}
      onInput={(text, caret) => {
        setDraft(text);
        setCaretOffset(caret);
      }}
    />
  ) : null;
  // the palette list below the composer while the caret is on a "/word"; null otherwise, so it pushes
  const paletteNode = (
    <ComposerPalette
      key="composer-palette"
      slashActive={slashActive}
      slashItems={slashItems}
      slashIndex={slashIndex}
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
          <CommentRow
            key={annotation.id}
            annotation={annotation}
            tokens={tokens}
            authorLabel={resolveAuthorLabel?.(annotation)}
            action={annotationAction?.(annotation.id)}
            onFocus={() => {
              blurSaveCompose();
              focusSavedComment(annotation.id, discussion.key);
              setCursor(discussion.blockIndex);
            }}
          />
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

  const composeBlockIndex = compose?.kind === "prompt" ? source.count - 1 : compose?.blockIndex;
  const cardsAfterLine = (
    blockIndex: number,
    line: VisualLine,
    isLastLine: boolean,
  ): React.ReactNode[] => {
    const endsInLine = (end: number): boolean =>
      (end === 0 && line.start === 0) || (end - 1 >= line.start && end - 1 < line.end);
    const nodes: React.ReactNode[] = [];
    const composeHere = compose && composeBlockIndex === blockIndex;
    const newComposeHere = Boolean(composeHere && compose.discussionKey === null && composerNode);
    const composeAnchoredHere =
      newComposeHere && (compose!.span ? endsInLine(compose!.span.end.char) : isLastLine);
    const composeStart = compose?.span?.start;

    const pushComposeCard = (): void => {
      if (compose?.kind === "prompt") {
        nodes.push(
          <box key="compose-prompt" style={{ paddingLeft: 2 }}>
            {composerNode}
          </box>,
        );
        nodes.push(paletteNode);

        return;
      }
      nodes.push(
        <DiscussionCard
          key="compose-new"
          tokens={tokens}
          segments={[{ color: palette.cardEdge, node: composerNode }]}
        />,
      );
      nodes.push(paletteNode);
    };

    // the draft sorts in by its span start, the same order discussionsFrom lands it on save, so a
    // new comment sits in its final position while typing instead of appending to the stack
    let composePending = composeAnchoredHere;

    for (const discussion of discussions) {
      if (discussion.blockIndex !== blockIndex || !endsInLine(discussion.span.end.char)) continue;
      if (
        composePending &&
        composeStart &&
        comparePositions(composeStart, discussion.span.start) < 0
      ) {
        pushComposeCard();
        composePending = false;
      }
      const composingHere = Boolean(composeHere && compose.discussionKey === discussion.key);

      if (folded.has(discussion.key) && !composingHere) {
        nodes.push(foldedSummaryFor(discussion));
        continue;
      }
      nodes.push(discussionCardFor(discussion, composingHere));
      if (composingHere) nodes.push(paletteNode);
    }
    if (composePending) pushComposeCard();

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

  const focusPrompt = (blockIndex: number): void => {
    const position = { blockIndex, char: 0 };

    setNavMode(false);
    setFocusedDiscussion(null);
    setCursor(blockIndex);
    setCaret({ head: position, anchor: position });
    openCompose({
      kind: "prompt",
      blockIndex,
      discussionKey: null,
      span: { start: position, end: position },
      seed: promptDraft.current,
      editAnnotationId: null,
    });
    promptDraft.current = "";
  };
  const movePromptDraft = useEffectEvent(() => {
    const active = composeRef.current;
    const blockIndex = source.count - 1;

    if (
      active?.kind !== "prompt" ||
      !isPromptBlock?.(blockIndex) ||
      active.blockIndex === blockIndex
    )
      return;
    const position = { blockIndex, char: 0 };

    openCompose({
      ...active,
      blockIndex,
      span: { start: position, end: position },
      seed: composeTextRef.current,
    });
    setCursor(blockIndex);
    setCaret({ head: position, anchor: position });
  });

  useEffect(() => {
    movePromptDraft();
  }, [source.count]);
  const restoredPrompt = useRef<number | null>(null);
  const restorePrompt = useEffectEvent(() => {
    if (!promptRestoreRequest || suspended || !onInvoke) return;
    if (restoredPrompt.current === promptRestoreRequest.id) return;
    restoredPrompt.current = promptRestoreRequest.id;
    const active = composeRef.current;
    const newerDraft = active?.kind === "prompt" ? composeTextRef.current : promptDraft.current;

    if (active?.kind !== "prompt") blurSaveCompose();
    promptDraft.current = [promptRestoreRequest.text, newerDraft].filter(Boolean).join("\n");
    focusPrompt(source.count - 1);
  });

  useEffect(() => {
    restorePrompt();
  }, [promptRestoreRequest?.id, suspended]);
  const focusedReply = useRef<string | null>(null);
  const continueConversation = useEffectEvent(() => {
    if (!promptFocusRequest || suspended || !onInvoke) return;
    if (focusedReply.current === promptFocusRequest.replyId) return;
    focusedReply.current = promptFocusRequest.replyId;
    // An arriving answer cannot replace a draft or a marked passage under review.
    if (composeRef.current || heldSpan || dragging.current || promptDraft.current) return;
    focusPrompt(promptFocusRequest.blockIndex);
  });

  useEffect(() => {
    continueConversation();
  }, [promptFocusRequest?.replyId, promptFocusRequest?.blockIndex, suspended]);
  const onPromptMouseDown = (event: TerminalMouseEvent): void => {
    if (!onInvoke || suspended) return;
    const blockIndex = source.count - 1;
    const geometry = allGeometry();
    const promptLine = geometry.find((entry) => isPromptBlock?.(entry.blockIndex));
    const lastReplyLine = geometry
      // Activity blocks render outside the text geometry, so use the last measured line.
      .filter((entry) => entry.blockIndex < blockIndex)
      .sort((left, right) => right.y - left.y)[0];
    const promptStart = promptLine ? promptLine.y - 1 : lastReplyLine && lastReplyLine.y + 1;
    const viewport = dragViewport?.();

    if (
      !isPromptBlock?.(blockIndex) ||
      promptStart === undefined ||
      event.y < promptStart ||
      (viewport && event.y >= viewport.bottom)
    )
      return;
    if (composeRef.current?.kind === "prompt") {
      promptDraft.current = composeTextRef.current;
    } else blurSaveCompose();
    endDrag();
    focusPrompt(blockIndex);
  };

  const onLineMouseDown = (event: TerminalMouseEvent): void => {
    blurSaveCompose();
    const pressed = positionAt(allGeometry(), event.x, event.y);

    if (!pressed || !source.annotatable(pressed.blockIndex)) return;
    setNavMode(false);
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
    navMode,
    focusedDiscussion,
    revealBlockIndex,
    headVisualY,
    prepareViewportScroll,
    spanQuote,
    registerLine,
    onLineMouseDown,
    rootMouseProps: {
      onMouseDown: onPromptMouseDown,
      onMouseDrag: handleRootDrag,
      onMouseDragEnd: endDrag,
      onMouseUp: endDrag,
    },
    rangesFor,
    cardsAfterLine,
    jumpToDiscussion,
    blurSaveCompose,
  };
}

function isAgentInvokeKey(
  key: { name: string; ctrl?: boolean; meta?: boolean; super?: boolean },
  onInvoke?: (commentId?: string) => void,
): boolean {
  return Boolean(
    onInvoke &&
    (key.name === "return" || key.name === "enter") &&
    key.ctrl &&
    !key.meta &&
    !key.super,
  );
}
