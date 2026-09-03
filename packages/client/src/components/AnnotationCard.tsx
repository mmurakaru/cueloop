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
  /**
   * When set, ⏎ in the textarea saves through this handler. The plan and diff
   * composers leave it unset because the app keymap owns ⏎ there; the prototype
   * composer sets it because the app keymap is suppressed while it is open.
   */
  onSubmit?: () => void;
}

export interface AnnotationSaved {
  body: string;
  isSelected: boolean;
  isOrphan: boolean;
  /** Border-title author: a collaborator's display name, or "me" for the reviewer's own note. */
  author: string;
  /** Border + title color for this card (comment cards read blue). */
  tone: string;
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
export function composeRowCount(
  text: string,
  contentWidth: number,
  cap: number = COMPOSE_MAX_ROWS,
): number {
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
  }, [onRowsChange]);

  return (
    <>
      <textarea
        ref={editorRef}
        focused
        initialValue={draft.text}
        placeholder="write a note..."
        keyBindings={COMPOSE_KEY_BINDINGS}
        {...(draft.onSubmit ? { onSubmit: draft.onSubmit } : {})}
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
          {" Cancel "}
        </Button>
      </Toolbar>
    </>
  );
}

export function AnnotationCard({
  id,
  kind,
  quote,
  draft,
  saved,
  theme,
}: AnnotationCardProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  // the composer wears the same blue as the saved comment card it becomes
  const kindColor = tokens.blue;
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
    const primitive = "comment on";

    return (
      <Card
        title={` ${primitive} "${truncateToSingleLine(quote, 40)}" `}
        contentRows={editorRowCount + 1}
        borderColor={kindColor}
        backgroundColor="transparent"
        theme={theme}
      >
        <DraftEditor
          draft={draft}
          rows={editorRowCount}
          onRowsChange={setEditorRowCount}
          theme={theme}
        />
      </Card>
    );
  }
  const card = saved!;
  // border = "what + who" (+ an orphaned flag when the anchor no longer resolves)
  const flags = card.isOrphan ? ["ORPHANED"] : [];
  const title = ` ${[kind.toUpperCase(), card.author, ...flags].join(" · ")} `;
  // every saved card is bordered, so the border + side padding always eat this width
  const borderInset = 4;
  // a bordered box must declare a height or it collapses: quote + body, or the editor
  const contentRows = card.editing ? editorRowCount + 2 : 2;

  return (
    <box
      id={id}
      title={title}
      style={{
        flexDirection: "column",
        height: cardHeight(contentRows),
        border: true,
        borderStyle: FRAME_BORDER_STYLE,
        // the border (and its title) always wears the card's tone - salmon for
        // own notes, blue for a collaborator's; the card background stays
        // transparent so it sits flat on the terminal theme. Selection reads
        // from the quote line taking the card's tone (below) and from the
        // matching text highlight in the document.
        borderColor: card.tone,
        backgroundColor: "transparent",
        paddingLeft: 1,
        paddingRight: 1,
      }}
      onMouseUp={card.onPress}
    >
      <text
        fg={card.isSelected ? card.tone : tokens.textDim}
      >{`"${truncateToSingleLine(quote, 26 - borderInset)}"`}</text>
      {card.editing ? (
        <DraftEditor
          draft={card.editing}
          rows={editorRowCount}
          onRowsChange={setEditorRowCount}
          theme={theme}
        />
      ) : (
        <text fg={card.isOrphan ? tokens.textDim : tokens.textMuted}>
          {truncateToSingleLine(card.body, 28 - borderInset)}
        </text>
      )}
    </box>
  );
}
