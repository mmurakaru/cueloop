/**
 * The inline comment pieces every annotated surface renders: the composer (a
 * textarea in a card row), the "/" actions-and-skills palette below it, the
 * edge-segmented discussion card, and one comment row. The plan thread view
 * and the diff sheet both draw their comments with these, so a discussion looks
 * and behaves the same on prose and on code.
 */

import React, { useContext, useLayoutEffect, useRef, useState } from "react";
import { usePaste } from "@opentui/react";
import type {
  BoxRenderable,
  KeyBinding,
  MouseEvent as TerminalMouseEvent,
  TextareaRenderable,
} from "@opentui/core";
import type { Annotation } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useTooltip } from "./Tooltip";
import { lighten } from "../annotation-palette";
import { useFrameMeasure } from "../use-frame-measure";
import { imagePlaceholder, looksLikeBinaryPaste } from "../pasted-image";
import { skillReferenceRanges, type SlashItem } from "../slash-palette";
import { PaletteNamesContext } from "../skills";
import { referenceStyleFor } from "./syntax-highlight";

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

export function composeRowCount(text: string, contentWidth: number): number {
  const usableWidth = contentWidth > 0 ? contentWidth : Number.MAX_SAFE_INTEGER;
  let visualRowCount = 0;

  for (const line of text.split("\n")) {
    visualRowCount += Math.max(1, Math.ceil(line.length / usableWidth));
  }

  // no cap: the card is the discussion, and folding is its containment
  return Math.max(1, visualRowCount);
}

export function Composer({
  seed,
  glyph,
  tokens,
  onSave,
  onReady,
  onInput,
  placeholder,
}: {
  seed: string;
  glyph: string;
  tokens: Theme;
  onSave: (body: string) => void;
  onReady: () => void;
  onInput: (text: string, caret: number) => void;
  placeholder?: string;
}): React.ReactNode {
  const editorRef = useRef<TextareaRenderable | null>(null);
  const pastedImageCount = useRef(0);
  const [rows, setRows] = useState(1);
  // action and skill names whose "/name" references paint in the accent color
  const referenceNames = useContext(PaletteNamesContext);

  usePaste((event) => {
    const editor = editorRef.current;

    if (!editor || !editor.focused || !looksLikeBinaryPaste(event.bytes)) return;
    event.preventDefault();
    pastedImageCount.current += 1;
    editor.editBuffer.insertText(imagePlaceholder(pastedImageCount.current));
  });

  const paintReferences = (editor: TextareaRenderable): void => {
    const { styleId } = referenceStyleFor(tokens);

    editor.editBuffer.clearAllHighlights();
    for (const range of skillReferenceRanges(editor.plainText, referenceNames)) {
      editor.editBuffer.addHighlightByCharRange({ ...range, styleId });
    }
  };

  // synchronously at commit, before the next tty key is read: signalling readiness in a
  // post-paint effect lets a fast burst race the mount, splitting input between the seed
  // buffer and this textarea out of order (#365)
  useLayoutEffect(() => {
    const editor = editorRef.current;

    if (!editor) return;
    editor.cursorOffset = seed.length;
    editor.editBuffer.setSyntaxStyle(referenceStyleFor(tokens).style);
    paintReferences(editor);
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
        placeholder={placeholder}
        placeholderColor={tokens.textDim}
        cursorStyle={{ style: "block", blinking: true }}
        keyBindings={COMPOSE_KEY_BINDINGS}
        onSubmit={() => onSave(editorRef.current?.plainText ?? "")}
        onContentChange={() => {
          const editor = editorRef.current;

          if (!editor) return;
          paintReferences(editor);
          setRows(composeRowCount(editor.plainText, editor.width));
          onInput(editor.plainText, editor.cursorOffset);
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

  const nameColumn = Math.min(36, Math.max(16, ...visible.map((item) => item.name.length + 5)));

  return (
    <box style={{ flexDirection: "column" }}>
      {visible.map((item, offset) => {
        const index = start + offset;
        const isSelected = index === selected;
        const name = `${isSelected ? "→ " : "  "}/${item.name}`.padEnd(nameColumn);

        return (
          <text key={item.name} style={{ flexShrink: 0, wrapMode: "none" }}>
            <span fg={isSelected ? tokens.accent : tokens.textMuted}>{name}</span>
            <span fg={tokens.textDim}>{item.description}</span>
          </text>
        );
      })}
      {items.length > WINDOW ? (
        <text fg={tokens.textDim}>{`(${selected + 1}/${items.length})`}</text>
      ) : null}
    </box>
  );
}

/** Below the composer: the actions/skills list while the caret is on a "/word", else nothing. */
export function ComposerPalette({
  slashActive,
  slashItems,
  slashIndex,
  tokens,
}: {
  slashActive: boolean;
  slashItems: SlashItem[];
  slashIndex: number;
  tokens: Theme;
}): React.ReactNode {
  if (!slashActive) return null;

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

/* ------------------------------------------------------------ discussion card */

/** One card row group with its own accent-edge color, one per voice. */
export interface EdgeSegment {
  color: string;
  node: React.ReactNode;
}

/**
 * The comment-card frame. The accent edge is drawn by hand so that (a) its
 * corner cells are half-height glyphs ("╷"/"╵") terminating flush with the
 * hairline rows, and (b) each voice's rows carry their own edge color with
 * zero gap. Focus lightens every segment; the hairlines never change.
 */
export function DiscussionCard({
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
    <box style={{ flexDirection: "row", marginTop: 0, marginLeft: 2 }}>
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

export function CommentRow({
  annotation,
  tokens,
  authorLabel,
}: {
  annotation: Annotation;
  tokens: Theme;
  /** The author's resolved display name, shown as a tooltip when the dot is hovered. */
  authorLabel?: string;
}): React.ReactNode {
  // own comments (no author) wear the filled dot, collaborators the outline
  const own = annotation.author === undefined;
  const glyph = own ? "●" : "○";
  const glyphColor = own ? tokens.text : tokens.textMuted;
  const { showTooltip, hideTooltip } = useTooltip();
  const dotHover = authorLabel
    ? {
        onMouseOver: (event: TerminalMouseEvent) => showTooltip(authorLabel, event.x, event.y),
        onMouseOut: hideTooltip,
      }
    : {};

  return (
    <box style={{ flexDirection: "column" }}>
      {annotation.body.split("\n").map((line, lineIndex) => (
        <box key={lineIndex} style={{ flexDirection: "row" }}>
          <box style={{ flexShrink: 0 }} {...(lineIndex === 0 ? dotHover : {})}>
            <text selectable={false} fg={glyphColor}>
              {lineIndex === 0 ? `${glyph} ` : "  "}
            </text>
          </box>
          <text fg={tokens.text} style={{ wrapMode: "word", flexGrow: 1, flexShrink: 1 }}>
            {line}
          </text>
        </box>
      ))}
    </box>
  );
}
