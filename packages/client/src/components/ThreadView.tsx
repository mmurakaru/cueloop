/**
 * The thread view: the plan surface where discussions live inline in the
 * document instead of the rail. A character-precise caret sits in the text;
 * typing opens a composer anchored at the caret word or held selection, a
 * discussion's replies stack in an edge-segmented card below the marked line,
 * and the right-edge scroll markers navigate between discussions. Gated behind
 * CUELOOP_THREAD_VIEW=1 while it graduates from the UX spike.
 *
 * Grammar: arrows move (caret flows across blocks) · shift+arrows select ·
 * click/drag mark · typing comments (or edits my trailing comment / replies
 * in a focused discussion) · "/" opens the quick-action palette · cmd+option+m
 * comments on selection · cmd+enter sends, enter breaks the line · esc
 * dismisses · tab folds · cmd+[ / cmd+] cycle discussions · blur-save on click.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  createTextAttributes,
  type BoxRenderable,
  type KeyBinding,
  type KeyEvent,
  type MouseEvent as TerminalMouseEvent,
  type ScrollBoxRenderable,
  type TextareaRenderable,
  type TextRenderable,
} from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { Annotation, ReviewSession } from "@cueloop/schema";
import { displayText, type DisplayBlock, type Mark } from "../view-plan";
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
  wordRanges,
  type ClickStamp,
  type LineGeometry,
  type TextPosition,
  type TextSpan,
} from "../thread-selection";
import { quickActionBody, type QuickAction } from "../config";
import type { CheatsheetSection } from "../key-bindings";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";

/* ------------------------------------------------------------- palette */

const UNDERLINE = createTextAttributes({ underline: true });
const CUT = createTextAttributes({ strikethrough: true, dim: true });
const BOLD = createTextAttributes({ bold: true });

/** The marked-words treatment: a violet backdrop under an underline. */
const MARK_BACKDROP_DARK = "#463852";
const MARK_BACKDROP_LIGHT = "#e6ddf5";
/** The discussion card's accent left edge. */
const CARD_EDGE_DARK = "#ab7aca";
const CARD_EDGE_LIGHT = "#8b5fd6";
/** The caret cell: a visible cursor painted on the character under the caret. */
const CARET_CELL_DARK = "#565b68";
const CARET_CELL_LIGHT = "#b8bcc8";

interface ThreadViewPalette {
  markBackdrop: string;
  cardEdge: string;
  caretCell: string;
}

/** Dark tokens carry light text; use that to pick the palette variant. */
function paletteFor(tokens: Theme): ThreadViewPalette {
  const dark = Number.parseInt(tokens.text.slice(1, 3) || "e4", 16) > 128;

  return dark
    ? {
        markBackdrop: MARK_BACKDROP_DARK,
        cardEdge: CARD_EDGE_DARK,
        caretCell: CARET_CELL_DARK,
      }
    : {
        markBackdrop: MARK_BACKDROP_LIGHT,
        cardEdge: CARD_EDGE_LIGHT,
        caretCell: CARET_CELL_LIGHT,
      };
}

/** Focus cue: mix a hex color toward white, keeping its hue readable. */
export function lighten(hex: string, amount = 0.25): string {
  const channels = hex.match(/^#(..)(..)(..)$/);

  if (!channels) return hex;
  const lifted = channels
    .slice(1)
    .map((channel) => {
      const value = Number.parseInt(channel, 16);

      return Math.round(value + (255 - value) * amount)
        .toString(16)
        .padStart(2, "0");
    })
    .join("");

  return `#${lifted}`;
}

/* ------------------------------------------------------------ measurement */

/**
 * Read a layout-dependent value after every rendered frame (and resize),
 * committing only on change. Layout lands after the commit, so a timer
 * would race the visual-idle wait; measuring on the frame event converges
 * deterministically within a frame or two.
 */
function useFrameMeasure<T>(read: () => T, isEqual: (left: T, right: T) => boolean, initial: T): T {
  const renderer = useRenderer();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const measure = (): void => {
      const next = read();

      setValue((current) => (isEqual(current, next) ? current : next));
    };

    measure();
    renderer?.on("frame", measure);
    renderer?.on("resize", measure);

    return () => {
      renderer?.off("frame", measure);
      renderer?.off("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer]);

  return value;
}

/* -------------------------------------------------------------- geometry */

interface MarkRange {
  start: number;
  end: number;
  /** The bare caret's single cell - a cursor, not yet a mark. */
  caretOnly?: boolean;
}

interface Run {
  text: string;
  marked: boolean;
  caretOnly: boolean;
}

/** Split a block's text into plain/marked runs from the union of ranges. */
function runsFor(text: string, ranges: MarkRange[]): Run[] {
  const cuts = new Set<number>([0, text.length]);

  for (const range of ranges) {
    cuts.add(Math.max(0, range.start));
    cuts.add(Math.min(text.length, range.end));
  }
  const edges = [...cuts].toSorted((left, right) => left - right);
  const runs: Run[] = [];

  for (let index = 0; index < edges.length - 1; index++) {
    const start = edges[index]!;
    const end = edges[index + 1]!;

    if (end <= start) continue;
    const covering = ranges.filter((range) => range.start <= start && end <= range.end);
    // the caret cell shows through a mark, so the head of a selection is visible
    runs.push({
      text: text.slice(start, end),
      marked: covering.some((range) => range.caretOnly !== true),
      caretOnly: covering.some((range) => range.caretOnly === true),
    });
  }

  return runs.length > 0 ? runs : [{ text, marked: false, caretOnly: false }];
}

/**
 * Greedy word wrap into visual-line char ranges, so a comment card can slot
 * in directly below the line its mark ends on (mid-paragraph when needed).
 */
function wrapLines(text: string, width: number): Array<{ start: number; end: number }> {
  const lines: Array<{ start: number; end: number }> = [];
  let segmentStart = 0;

  // hard breaks first: every visual line must be exactly one terminal row,
  // or hit-testing and the mark geometry drift from what is painted
  for (const segment of text.split("\n")) {
    const segmentEnd = segmentStart + segment.length;

    if (width <= 0 || segment.length <= width) {
      lines.push({ start: segmentStart, end: segmentEnd });
    } else {
      // greedy word wrap inside the segment; the first line keeps its
      // leading indentation, continuation lines start at a word
      let lineStart = segmentStart;
      let lineEnd = segmentStart;

      for (const word of wordRanges(segment)) {
        const wordStart = segmentStart + word.start;
        const wordEnd = segmentStart + word.end;

        if (wordEnd - lineStart > width && lineEnd > lineStart) {
          lines.push({ start: lineStart, end: lineEnd });
          lineStart = wordStart;
        }
        lineEnd = wordEnd;
      }
      lines.push({ start: lineStart, end: Math.max(lineEnd, lineStart) });
    }
    segmentStart = segmentEnd + 1;
  }

  return lines;
}

/** A printable character: single-width input that should reach a composer. */
function printableSequence(key: KeyEvent): string | null {
  const printable =
    key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta && key.sequence >= " ";

  return printable ? key.sequence : null;
}

/* ---------------------------------------------------------------- discussions */

/** One conversation: a root annotation, its replies, and the span they mark. */
interface Discussion {
  key: string;
  /** The annotation replies attach to. */
  rootId: string;
  /** The block the card renders under: where the span ends. */
  blockIndex: number;
  span: TextSpan;
  annotations: Annotation[];
}

function spanKey(span: TextSpan): string {
  return `${span.start.blockIndex}:${span.start.char}:${span.end.blockIndex}:${span.end.char}`;
}

/**
 * Roots group by the span they resolved to (two roots on the very same text
 * read as one conversation); replies join the discussion their replyTo names, or
 * stand as roots when that root is gone.
 */
function discussionsFrom(session: ReviewSession, marks: Map<number, Mark[]>): Discussion[] {
  const byId = new Map(session.annotations.map((annotation) => [annotation.id, annotation]));
  const spanOf = new Map<string, TextSpan>();

  for (const [displayIndex, blockMarks] of marks) {
    for (const mark of blockMarks) {
      if (!mark.annotationId || spanOf.has(mark.annotationId)) continue;
      spanOf.set(
        mark.annotationId,
        mark.span ?? {
          start: { blockIndex: displayIndex, char: mark.start },
          end: { blockIndex: displayIndex, char: mark.end },
        },
      );
    }
  }
  const resolved = [...spanOf.keys()].map((id) => byId.get(id)!).filter(Boolean);
  const isRoot = (annotation: Annotation): boolean =>
    annotation.replyTo === undefined || !spanOf.has(annotation.replyTo);
  const grouped = new Map<string, Discussion>();
  const discussionOfRoot = new Map<string, Discussion>();

  for (const annotation of resolved.filter(isRoot)) {
    const span = spanOf.get(annotation.id)!;
    const key = spanKey(span);
    const discussion = grouped.get(key) ?? {
      key,
      rootId: annotation.id,
      blockIndex: span.end.blockIndex,
      span,
      annotations: [],
    };

    discussion.annotations.push(annotation);
    grouped.set(key, discussion);
    discussionOfRoot.set(annotation.id, discussion);
  }
  for (const annotation of resolved.filter((candidate) => !isRoot(candidate))) {
    discussionOfRoot.get(annotation.replyTo!)?.annotations.push(annotation);
  }
  for (const discussion of grouped.values()) {
    discussion.annotations.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  return [...grouped.values()].toSorted((left, right) =>
    comparePositions(left.span.start, right.span.start),
  );
}

/* -------------------------------------------------------------- composer */

// cmd+enter sends (super under the kitty protocol, meta where cmd arrives
// ESC-prefixed, ctrl as the fallback where the terminal itself consumes
// cmd+enter); plain enter breaks the line
const COMPOSE_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", super: true, action: "submit" },
  { name: "return", meta: true, action: "submit" },
  { name: "return", ctrl: true, action: "submit" },
  { name: "return", action: "newline" },
  { name: "return", shift: true, action: "newline" },
];

function composeRowCount(text: string, contentWidth: number): number {
  const usableWidth = contentWidth > 0 ? contentWidth : Number.MAX_SAFE_INTEGER;
  let visualRowCount = 0;

  for (const line of text.split("\n")) {
    visualRowCount += Math.max(1, Math.ceil(line.length / usableWidth));
  }

  // no cap: the card is the discussion, and folding is its containment
  return Math.max(1, visualRowCount);
}

function Composer({
  seed,
  glyph,
  tokens,
  onSave,
  onReady,
  onInput,
}: {
  seed: string;
  glyph: string;
  tokens: Theme;
  onSave: (body: string) => void;
  onReady: () => void;
  onInput: (text: string) => void;
}): React.ReactNode {
  const editorRef = useRef<TextareaRenderable | null>(null);
  const [rows, setRows] = useState(1);

  // once per mount (the composer is keyed by its seed): later re-renders
  // must NOT reset the caret, or input lands before a just-typed newline
  useEffect(() => {
    const editor = editorRef.current;

    if (!editor) return;
    editor.cursorOffset = seed.length;
    setRows(composeRowCount(editor.plainText, editor.width));
    onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <box style={{ flexDirection: "row" }}>
      <text selectable={false} fg={tokens.text} style={{ flexShrink: 0 }}>{`${glyph} `}</text>
      <textarea
        ref={editorRef}
        focused
        initialValue={seed}
        cursorStyle={{ style: "block", blinking: true }}
        keyBindings={COMPOSE_KEY_BINDINGS}
        onSubmit={() => onSave(editorRef.current?.plainText ?? "")}
        onContentChange={() => {
          const editor = editorRef.current;

          if (!editor) return;
          setRows(composeRowCount(editor.plainText, editor.width));
          onInput(editor.plainText);
        }}
        style={{
          height: rows,
          flexGrow: 1,
          backgroundColor: "transparent",
          focusedBackgroundColor: "transparent",
          textColor: tokens.text,
          focusedTextColor: tokens.text,
        }}
      />
    </box>
  );
}

/* ---------------------------------------------------------- slash palette */

interface SlashItem {
  name: string;
  description: string;
  body: string;
}

function slashItemsFrom(quickActions: QuickAction[]): SlashItem[] {
  return quickActions.map((action) => ({
    name: action.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    description: action.metadata ?? action.prompt,
    body: quickActionBody(action),
  }));
}

/** Prefix beats substring beats subsequence. */
function slashFilter(items: SlashItem[], query: string): SlashItem[] {
  const needle = query.toLowerCase();

  if (needle.length === 0) return items;
  const scored: Array<{ item: SlashItem; score: number }> = [];

  for (const item of items) {
    const name = item.name.toLowerCase();
    let score = 0;

    if (name.startsWith(needle)) score = 3;
    else if (name.includes(needle)) score = 2;
    else {
      let matched = 0;

      for (const character of name) {
        if (character === needle[matched]) matched++;
      }
      if (matched === needle.length) score = 1;
    }
    if (score > 0) scored.push({ item, score });
  }

  return scored.toSorted((left, right) => right.score - left.score).map((entry) => entry.item);
}

/**
 * A skill invoked mid-sentence: the trailing "/word" token when text already
 * precedes it (a draft that starts with "/" is the palette, not an inline
 * completion). Newline-safe, since the token may sit at the start of a new line.
 */
export function inlineSlashToken(text: string): string | null {
  if (text.startsWith("/")) return null;
  const match = /(?:^|\s)(\/[a-zA-Z0-9-]*)$/.exec(text);

  return match ? match[1]! : null;
}

interface InlineSlash {
  token: string;
  suggestion: SlashItem;
}

/** The inline completion state: the trailing "/word" and its closest skill, or null. */
export function resolveInlineSuggestion(
  slashActive: boolean,
  text: string,
  quickActions: QuickAction[],
): InlineSlash | null {
  if (slashActive) return null;
  const token = inlineSlashToken(text);

  if (token === null) return null;
  const suggestion = slashFilter(slashItemsFrom(quickActions), token.slice(1))[0];

  return suggestion ? { token, suggestion } : null;
}

function SlashList({
  items,
  selected,
  tokens,
}: {
  items: SlashItem[];
  selected: number;
  tokens: Theme;
}): React.ReactNode {
  const WINDOW = 5;
  const start = Math.max(0, Math.min(selected - 2, items.length - WINDOW));
  const visible = items.slice(start, start + WINDOW);

  if (items.length === 0) return <text fg={tokens.textDim}>no matching actions</text>;

  return (
    <box style={{ flexDirection: "column" }}>
      {visible.map((item, offset) => {
        const index = start + offset;
        const isSelected = index === selected;

        return (
          <text key={item.name} style={{ flexShrink: 1 }}>
            <span fg={isSelected ? tokens.accent : tokens.textDim}>{isSelected ? "→ " : "  "}</span>
            <span fg={isSelected ? tokens.text : tokens.textMuted}>
              {`action:${item.name}`.padEnd(34)}
            </span>
            <span fg={tokens.textDim}>{item.description.slice(0, 52)}</span>
          </text>
        );
      })}
      {items.length > WINDOW ? (
        <text fg={tokens.textDim}>{`(${selected + 1}/${items.length})`}</text>
      ) : null}
    </box>
  );
}

/** Below the composer: the palette list for a leading "/", else the inline tab-hint, else nothing. */
function ComposerPalette({
  slashActive,
  slashItems,
  slashIndex,
  inline,
  tokens,
}: {
  slashActive: boolean;
  slashItems: SlashItem[];
  slashIndex: number;
  inline: InlineSlash | null;
  tokens: Theme;
}): React.ReactNode {
  if (slashActive) {
    return (
      <box style={{ flexDirection: "column", marginLeft: 3 }}>
        <SlashList
          items={slashItems}
          selected={Math.min(slashIndex, Math.max(0, slashItems.length - 1))}
          tokens={tokens}
        />
      </box>
    );
  }
  if (inline === null) return null;

  return (
    <box style={{ flexDirection: "row", marginLeft: 3 }}>
      <text>
        <span fg={tokens.textDim}>{"⇥ "}</span>
        <span fg={tokens.accent}>{`/${inline.suggestion.name}`}</span>
        <span fg={tokens.textDim}>{`  ${inline.suggestion.description}`}</span>
      </text>
    </box>
  );
}

/* ------------------------------------------------------------ discussion card */

/** One card row group with its own accent-edge color, one per voice. */
interface EdgeSegment {
  color: string;
  node: React.ReactNode;
}

/**
 * The comment-card frame. The accent edge is drawn by hand so that (a) its
 * corner cells are half-height glyphs ("╷"/"╵") terminating flush with the
 * hairline rows, and (b) each voice's rows carry their own edge color with
 * zero gap. Focus lightens every segment; the hairlines never change.
 */
function DiscussionCard({
  segments,
  tokens,
  focused = false,
  onFocus,
}: {
  segments: EdgeSegment[];
  tokens: Theme;
  focused?: boolean;
  onFocus?: () => void;
}): React.ReactNode {
  const segmentRefs = useRef<Array<BoxRenderable | null>>([]);
  const noHeights: number[] = [];
  const heights = useFrameMeasure(
    () => segmentRefs.current.map((renderable) => renderable?.height ?? 0),
    (left, right) => left.join() === right.join(),
    noHeights,
  );

  const edgeColor = (color: string): string => (focused ? lighten(color) : color);
  const glyphs = focused
    ? { top: "╻", middle: "┃", bottom: "╹" }
    : { top: "╷", middle: "│", bottom: "╵" };
  const edgeRows: Array<{ glyph: string; color: string }> = [
    {
      glyph: glyphs.top,
      color: edgeColor(segments[0]?.color ?? tokens.border),
    },
  ];

  for (let index = 0; index < segments.length; index++) {
    const segmentRows = Math.max(1, heights[index] ?? 1);

    for (let row = 0; row < segmentRows; row++) {
      edgeRows.push({
        glyph: glyphs.middle,
        color: edgeColor(segments[index]!.color),
      });
    }
  }
  edgeRows.push({
    glyph: glyphs.bottom,
    color: edgeColor(segments[segments.length - 1]?.color ?? tokens.border),
  });

  return (
    <box style={{ flexDirection: "row", marginTop: 1, marginLeft: 2 }}>
      <text selectable={false} style={{ flexShrink: 0, width: 1 }}>
        {edgeRows.map((row, index) => (
          <span key={index} fg={row.color}>
            {index < edgeRows.length - 1 ? `${row.glyph}\n` : row.glyph}
          </span>
        ))}
      </text>
      <box
        onMouseDown={onFocus}
        style={{
          flexGrow: 1,
          flexDirection: "column",
          border: ["top", "right", "bottom"],
          borderStyle: "single",
          borderColor: tokens.border,
          backgroundColor: "transparent",
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        {segments.map((segment, index) => (
          <box
            key={index}
            ref={(renderable: BoxRenderable | null) => {
              segmentRefs.current[index] = renderable;
            }}
            style={{ flexDirection: "column" }}
          >
            {segment.node}
          </box>
        ))}
      </box>
    </box>
  );
}

function CommentRow({
  annotation,
  tokens,
}: {
  annotation: Annotation;
  tokens: Theme;
}): React.ReactNode {
  // own comments (no author) wear the filled dot, collaborators the outline
  const own = annotation.author === undefined;
  const glyph = own ? "●" : "○";
  const glyphColor = own ? tokens.text : tokens.textMuted;

  return (
    <box style={{ flexDirection: "column" }}>
      {annotation.body.split("\n").map((line, lineIndex) => (
        <box key={lineIndex} style={{ flexDirection: "row" }}>
          <text selectable={false} fg={glyphColor} style={{ flexShrink: 0 }}>
            {lineIndex === 0 ? `${glyph} ` : "  "}
          </text>
          <text fg={tokens.text} style={{ wrapMode: "word", flexGrow: 1, flexShrink: 1 }}>
            {line}
          </text>
        </box>
      ))}
    </box>
  );
}

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
  onHover: (marker: { key: string; row: number } | null) => void;
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
        const index = indexAt(event.y - (railRef.current?.y ?? 0));

        onHover(index === null ? null : { key: discussions[index]!.key, row: rowFor(index) });
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

interface ComposeState {
  /** The block the card renders under: where the span ends. */
  blockIndex: number;
  /** Reply target; null composes a new discussion. */
  discussionKey: string | null;
  span: TextSpan | null;
  seed: string;
  /** When set, the composer rewrites this annotation instead of appending. */
  editAnnotationId: string | null;
}

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
  const palette = paletteFor(tokens);
  const discussions = discussionsFrom(session, marks);
  const [cursor, setCursor] = useState(0);
  // character-precise: `head` is the caret, `anchor` the other end of a held
  // selection (the same position when collapsed); both are full positions, so
  // the cursor block (cards, folding) can move without conjuring a selection
  const [caret, setCaret] = useState<{
    head: TextPosition;
    anchor: TextPosition;
  }>({
    head: { blockIndex: 0, char: 0 },
    anchor: { blockIndex: 0, char: 0 },
  });
  const [compose, setCompose] = useState<ComposeState | null>(null);

  useEffect(() => {
    onComposingChange?.(compose !== null);
  }, [compose, onComposingChange]);
  useEffect(() => {
    onCursorChange?.(caret.head.blockIndex);
  }, [caret.head.blockIndex, onCursorChange]);

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
  const [hoveredMarker, setHoveredMarker] = useState<{
    key: string;
    row: number;
  } | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const composerReady = useRef(false);
  const composeRef = useRef<ComposeState | null>(null);
  // every visual line registers its renderable so a drag can hit-test any
  // row on screen, across blocks (rows without text resolve to the block above)
  const lineRenderables = useRef(
    new Map<
      string,
      {
        blockIndex: number;
        start: number;
        end: number;
        renderable: TextRenderable;
      }
    >(),
  );
  // the press anchors the gesture; the first drag samples can land before
  // React has re-rendered, so the anchor travels with the gesture, not the closure
  const dragging = useRef<{
    wordMode: boolean;
    anchor: TextPosition;
    head: TextPosition;
  } | null>(null);
  const lastClick = useRef<ClickStamp | null>(null);
  const viewWidth = useFrameMeasure(
    () => scrollRef.current?.content?.width ?? 0,
    (left, right) => left === right,
    0,
  );

  // an opening card shifts the layout, so the block it belongs to is revealed
  // again; a discussion focused from the rail is scrolled into view the same way
  const revealBlockIndex =
    compose?.blockIndex ??
    discussions.find((discussion) => discussion.key === focusedDiscussion)?.blockIndex ??
    cursor;

  useEffect(() => {
    try {
      scrollRef.current?.scrollChildIntoView(`discussion-block-${revealBlockIndex}`);
    } catch {
      // best-effort reveal
    }
  }, [revealBlockIndex]);

  const blockText = (blockIndex: number): string => displayText(display[blockIndex]!);
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
  /** The text a span covers, blocks joined by a space, for previews. */
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
    if (delta === 1 && head.blockIndex < display.length - 1) return moveTo(head.blockIndex + 1, 0);
    if (delta === -1 && head.blockIndex > 0) {
      const previousText = blockText(head.blockIndex - 1);

      moveTo(
        head.blockIndex - 1,
        extend ? previousText.length : (previousWordStart(previousText, previousText.length) ?? 0),
      );
    }
  };

  const handleCaretKey = (key: KeyEvent): boolean => {
    const vertical =
      key.name === "up" || (key.ctrl && key.name === "p")
        ? -1
        : key.name === "down" || (key.ctrl && key.name === "n")
          ? 1
          : 0;

    if (vertical !== 0) {
      const next = Math.max(0, Math.min(display.length - 1, cursor + vertical));

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

  // ── render, split per concern to stay within the complexity budget ──

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

  /** Ranges to paint on a block: discussion marks, the compose mark, the caret. */
  const blockRangesFor = (blockIndex: number): MarkRange[] => {
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

  interface LineContext {
    blockIndex: number;
    text: string;
    line: { start: number; end: number };
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
    const lineRanges = ranges
      .map((range) => ({
        start: Math.max(range.start, line.start) - line.start,
        end: Math.min(range.end, line.end) - line.start,
        caretOnly: range.caretOnly,
      }))
      .filter((range) => range.end > range.start);

    return (
      <box key={`line-${lineIndex}`} style={{ flexDirection: "row" }}>
        <text selectable={false}>
          <span fg={tokens.textDim}>{"  "}</span>
          <span fg={tokens.textDim}>{lineIndex === 0 ? marker : " ".repeat(marker.length)}</span>
        </text>
        <text
          selectable={false}
          style={{ flexGrow: 1, flexShrink: 1 }}
          ref={(renderable: TextRenderable | null) => {
            const key = `${blockIndex}:${lineIndex}`;

            if (renderable) {
              lineRenderables.current.set(key, {
                blockIndex,
                start: line.start,
                end: line.end,
                renderable,
              });
            } else lineRenderables.current.delete(key);
          }}
          onMouseDown={(event) => {
            blurSaveCompose();
            const pressed = positionAt(allGeometry(), event.x, event.y);

            if (!pressed) return;
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
          }}
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

  /** Cards anchored to a visual line: discussion cards, the new-discussion composer. */
  const cardsAfterLine = (
    blockIndex: number,
    line: { start: number; end: number },
    isLastLine: boolean,
    blockDiscussions: Discussion[],
  ): React.ReactNode[] => {
    const endsInLine = (end: number): boolean => end - 1 >= line.start && end - 1 < line.end;
    const nodes: React.ReactNode[] = [];
    const composeHere = compose && compose.blockIndex === blockIndex;

    for (const discussion of blockDiscussions) {
      if (!endsInLine(discussion.span.end.char)) continue;
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

  const blockNodeFor = (blockIndex: number): React.ReactNode => {
    const block = display[blockIndex]!;
    const text = blockText(blockIndex);
    // cards live under the block a span ends in; marks paint on every block it covers
    const blockDiscussions = discussions.filter(
      (discussion) => discussion.blockIndex === blockIndex,
    );
    const ranges = blockRangesFor(blockIndex);
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
      const cards = cardsAfterLine(blockIndex, line, isLastLine, blockDiscussions);

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
    const quote = spanQuote(preview.span);
    const lastComment = preview.annotations.at(-1)!;

    return (
      <box
        style={{
          position: "absolute",
          top: Math.max(0, hoveredMarker.row - 1),
          right: 4,
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

  return (
    <box
      style={{ flexGrow: 1, flexDirection: "row" }}
      onMouseDrag={handleRootDrag}
      onMouseDragEnd={endDrag}
      onMouseUp={endDrag}
    >
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
        onJump={jumpToDiscussion}
      />
      {markerPreview()}
    </box>
  );
}
