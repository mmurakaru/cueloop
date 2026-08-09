/**
 * One annotation component in three modes: a draft composer (bordered card
 * inline in the document flow), a saved rail card, and the rail card editing
 * its body in place. Compose, saved, and re-edit share this rendering path,
 * so the kind-color and quote treatment can never drift between them.
 *
 * Bodies are multiline: the composer is a textarea (wrap, undo/redo,
 * shift+⏎ for a new line) while plain ⏎ stays the save key.
 */

import React, { useEffect, useRef } from "react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Card } from "./primitives/Card";
import { Button } from "./primitives/Button";
import { Toolbar } from "./primitives/Toolbar";
import { truncate } from "./format";

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

/** ⏎ saves (the grammar owns it); shift+⏎ makes the body multiline. */
const COMPOSE_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
];

function editorRows(text: string): number {
  return Math.min(4, Math.max(1, text.split("\n").length));
}

function DraftEditor({ draft, theme }: { draft: AnnotationDraft; theme?: Theme }): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const editorRef = useRef<TextareaRenderable | null>(null);
  // re-edit opens with the caret after the existing body, like a text field
  const initialTextLength = useRef(draft.text.length);
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) editor.cursorOffset = initialTextLength.current;
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
          if (editor) draft.onInput(editor.plainText);
        }}
        style={{
          height: editorRows(draft.text),
          backgroundColor: tokens.elevated,
          focusedBackgroundColor: tokens.elevated,
          textColor: tokens.text,
          focusedTextColor: tokens.text,
        }}
      />
      <Toolbar>
        <Button variant="solid" marginRight={2} onPress={draft.onSave} theme={theme}>
          {" Save ⏎ "}
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
  if (draft) {
    const verb = kind === "suggestion" ? "suggest replacement for" : "comment on";
    return (
      <Card
        title={` ${verb} "${truncate(quote, 40)}" `}
        contentRows={editorRows(draft.text) + 1}
        borderColor={kindColor}
        marginLeft={2}
        marginRight={2}
        theme={theme}
      >
        <DraftEditor draft={draft} theme={theme} />
      </Card>
    );
  }
  const card = saved!;
  return (
    <box
      id={id}
      style={{ flexDirection: "column", marginBottom: 1, backgroundColor: card.isSelected ? tokens.elevated : undefined }}
      onMouseUp={card.onPress}
    >
      <text fg={card.isSelected ? tokens.text : kindColor}>
        {card.isSelected ? "▸ " : "  "}
        {kind.toUpperCase()}
        {card.isBlocking ? <span fg={tokens.red}> · BLOCKING</span> : null}
        <span fg={tokens.textDim}>{card.isOrphan ? " · ORPHANED" : " · pending"}</span>
      </text>
      <text fg={tokens.textDim}>  "{truncate(quote, 26)}"</text>
      {card.editing ? (
        <DraftEditor draft={card.editing} theme={theme} />
      ) : (
        <text fg={card.isOrphan ? tokens.textDim : tokens.textMuted}>  {truncate(card.body, 28)}</text>
      )}
    </box>
  );
}
