/**
 * One annotation component in three modes: a draft composer (bordered card
 * inline in the document flow), a saved rail card, and the rail card editing
 * its body in place. Compose, saved, and re-edit share this rendering path,
 * so the kind-color and quote treatment can never drift between them.
 *
 * Bodies are multiline: the composer is a textarea (wrap, undo/redo). Plain ⏎
 * stays the save key while ⌥/Alt+⏎ and shift+⏎ insert a new line (the Slack
 * convention). The box auto-grows with the wrapped text up to a cap, then
 * scrolls internally.
 */

import React, { useEffect, useRef, useState } from "react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Card, cardHeight } from "./primitives/Card";
import { FRAME_BORDER_STYLE } from "./primitives/frame";
import { Button } from "./primitives/Button";
import { Toolbar } from "./primitives/Toolbar";
import { truncateToSingleLine } from "./truncate-text";

export interface AnnotationDraft {
  text: string;
  onInput: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export interface AnnotationSaved {
  body: string;
  isSelected: boolean;
  isOrphan: boolean;
  isBlocking: boolean;
  /** A collaborator's resolved display name; own notes carry none. Set = name-in-border, blue. */
  authorLabel?: string;
  /** The viewer's own note when collaborators are also present (e.g. "me"). Set = tag-in-border, accent. */
  selfLabel?: string;
  /** Non-null while the card body is being rewritten in place. */
  editing: AnnotationDraft | null;
  onPress: () => void;
}

export interface AnnotationCardProps {
  id?: string;
  kind: string;
  quote: string;
  draft?: AnnotationDraft;
  saved?: AnnotationSaved;
  theme?: Theme;
}

/**
 * ⏎ submits (which keeps the textarea from inserting its default newline; the
 * grammar owns the actual save). ⌥/Alt+⏎ and shift+⏎ insert a newline so the
 * body can grow multiline without leaving the composer.
 *
 * Option/Alt reaches a binding as `meta`, not `option`: a binding key here is
 * built from name+ctrl+shift+meta+super only, so the newline binding matches on
 * `meta`. This also overrides the textarea default that maps meta+⏎ to submit.
 */
const COMPOSE_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", meta: true, action: "newline" },
  { name: "return", shift: true, action: "newline" },
];

/** The composer never grows past this many rows; beyond it the textarea scrolls. */
export const COMPOSE_MAX_ROWS = 4;

/**
 * Visible row count for the composer, so a soft-wrapped long line grows the box
 * just like a hard newline does. Each logical line takes `ceil(length /
 * contentWidth)` visual rows (at least one), summed over the hard-newline lines
 * and capped. A non-positive width (before layout is known) counts hard
 * newlines only. Beyond the cap the textarea scrolls internally and keeps the
 * caret line in view.
 */
export function composeRowCount(text: string, contentWidth: number, cap: number = COMPOSE_MAX_ROWS): number {
  const usableWidth = contentWidth > 0 ? contentWidth : Number.MAX_SAFE_INTEGER;
  let visualRowCount = 0;
  for (const line of text.split("\n")) {
    visualRowCount += Math.max(1, Math.ceil(line.length / usableWidth));
  }
  return Math.min(cap, Math.max(1, visualRowCount));
}

function DraftEditor({
  draft,
  rows,
  onRowsChange,
  theme,
}: {
  draft: AnnotationDraft;
  /** Current visible height in rows; owned by the parent so the card frame agrees. */
  rows: number;
  onRowsChange: (rows: number) => void;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const editorRef = useRef<TextareaRenderable | null>(null);
  // re-edit opens with the caret after the existing body, like a text field
  const initialTextLength = useRef(draft.text.length);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.cursorOffset = initialTextLength.current;
    // the box is laid out now, so its width is known: size to the wrapped body
    onRowsChange(composeRowCount(editor.plainText, editor.width));
  }, []);
  return (
    <>
      <textarea
        ref={editorRef}
        focused
        initialValue={draft.text}
        placeholder="write a note..."
        keyBindings={COMPOSE_KEY_BINDINGS}
        onContentChange={() => {
          const editor = editorRef.current;
          if (!editor) return;
          draft.onInput(editor.plainText);
          onRowsChange(composeRowCount(editor.plainText, editor.width));
        }}
        style={{
          height: rows,
          backgroundColor: "transparent",
          focusedBackgroundColor: "transparent",
          textColor: tokens.text,
          focusedTextColor: tokens.text,
        }}
      />
      <Toolbar>
        <Button variant="solid" marginRight={2} onPress={draft.onSave} theme={theme}>
          {" Save "}
        </Button>
        <Button onPress={draft.onCancel} theme={theme}>
          {" Cancel esc "}
        </Button>
      </Toolbar>
    </>
  );
}

export function AnnotationCard({ id, kind, quote, draft, saved, theme }: AnnotationCardProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const kindColor = kind === "suggestion" ? tokens.green : tokens.accent;
  const activeDraft = draft ?? saved?.editing ?? null;
  // The composer's visible height, grown from the wrapped text. It is shared
  // with the card frame (contentRows) so the border never clips the textarea
  // or the toolbar. Seeded from hard newlines, then corrected once the mounted
  // textarea reports its measured width.
  const [editorRowCount, setEditorRowCount] = useState(() =>
    // Width 0 is the "layout not known yet" contract: count hard newlines only,
    // until the mounted textarea reports its measured width below.
    composeRowCount(activeDraft?.text ?? "", 0),
  );
  if (draft) {
    const verb = kind === "suggestion" ? "suggest replacement for" : "comment on";
    return (
      <Card
        title={` ${verb} "${truncateToSingleLine(quote, 40)}" `}
        contentRows={editorRowCount + 1}
        borderColor={kindColor}
        backgroundColor="transparent"
        marginLeft={2}
        marginRight={2}
        theme={theme}
      >
        <DraftEditor draft={draft} rows={editorRowCount} onRowsChange={setEditorRowCount} theme={theme} />
      </Card>
    );
  }
  const card = saved!;
  const collaboratorName = card.authorLabel !== undefined && card.authorLabel !== "" ? card.authorLabel : undefined;
  const ownTag = card.selfLabel !== undefined && card.selfLabel !== "" ? card.selfLabel : undefined;
  const borderLabel = collaboratorName ?? ownTag;
  const borderColor = ownTag ? tokens.accent : tokens.blue;
  const indent = borderLabel ? "" : "  ";
  const marker = card.isSelected ? "▸ " : indent;
  // Fixed content rows (a bordered box must declare a height or it collapses): header + quote + body, or the editor.
  const contentRows = card.editing ? editorRowCount + 3 : 3;
  // The border + its side padding eat this much content width, so text truncates shorter.
  const borderInset = borderLabel ? 4 : 0;
  return (
    <box
      id={id}
      title={borderLabel ? ` ${borderLabel} ` : undefined}
      style={{
        flexDirection: "column",
        marginBottom: 0,
        backgroundColor: card.isSelected && !card.editing ? tokens.elevated : undefined,
        ...(borderLabel
          ? { height: cardHeight(contentRows), border: true, borderStyle: FRAME_BORDER_STYLE, borderColor, paddingLeft: 1, paddingRight: 1 }
          : {}),
      }}
      onMouseUp={card.onPress}
    >
      <text fg={card.isSelected ? tokens.text : kindColor}>
        {marker}
        {kind.toUpperCase()}
        {card.isBlocking ? <span fg={tokens.red}> · BLOCKING</span> : null}
        <span fg={tokens.textDim}>{card.isOrphan ? " · ORPHANED" : " · pending"}</span>
      </text>
      <text fg={tokens.textDim}>{indent}"{truncateToSingleLine(quote, 26 - borderInset)}"</text>
      {card.editing ? (
        <DraftEditor draft={card.editing} rows={editorRowCount} onRowsChange={setEditorRowCount} theme={theme} />
      ) : (
        <text fg={card.isOrphan ? tokens.textDim : tokens.textMuted}>{indent}{truncateToSingleLine(card.body, 28 - borderInset)}</text>
      )}
    </box>
  );
}
