/**
 * The native inline markdown editor for a thread's body: a full-height text area
 * over the working copy that paints markdown syntax as you type - headings,
 * bold, italic, inline and fenced code, links, list and quote markers - and
 * reports the caret line and column, replacing the external-editor hand-off so
 * editing needs no per-user editor configuration. cmd, meta, or ctrl + enter
 * and escape both save the working copy and close (leaving is loss-free, like
 * the editor hand-off it replaces); plain enter breaks the line. The raw
 * markdown stays visible - a concealed rendered preview is a later layer.
 */

import React, { useLayoutEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import { type Theme } from "../theme";
import { markdownHighlightRanges } from "../markdown-highlight";
import { markdownEditorStyle } from "../markdown-editor-syntax-style";

export interface MarkdownThreadEditorProps {
  /** The thread body's working copy; the editor opens on this markdown text. */
  initialText: string;
  theme: Theme;
  /** Called with the edited markdown when the reviewer leaves (cmd/ctrl+enter or escape); both save. */
  onExitEditor: (text: string) => void;
}

// cmd, meta, or ctrl + enter saves (super under the kitty protocol, meta where
// cmd arrives ESC-prefixed, ctrl as the terminal fallback); plain enter breaks
// the line, so the whole body edits like a normal editor
const MARKDOWN_EDITOR_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", super: true, action: "submit" },
  { name: "return", meta: true, action: "submit" },
  { name: "return", ctrl: true, action: "submit" },
  { name: "return", action: "newline" },
  { name: "return", shift: true, action: "newline" },
];

/** The caret's 1-based line and column, plus the buffer's total line count, for the status footer. */
interface MarkdownEditorPosition {
  line: number;
  column: number;
  lineCount: number;
}

export function MarkdownThreadEditor({
  initialText,
  theme,
  onExitEditor,
}: MarkdownThreadEditorProps): React.ReactNode {
  const editorRef = useRef<TextareaRenderable | null>(null);
  const [position, setPosition] = useState<MarkdownEditorPosition>({
    line: 1,
    column: 1,
    lineCount: initialText.split("\n").length,
  });

  const exitWithCurrentText = (): void =>
    onExitEditor(editorRef.current?.plainText ?? initialText);

  const paintMarkdown = (editor: TextareaRenderable): void => {
    const { styleIdFor } = markdownEditorStyle(theme);

    editor.editBuffer.clearAllHighlights();
    for (const range of markdownHighlightRanges(editor.plainText)) {
      editor.editBuffer.addHighlightByCharRange({
        start: range.start,
        end: range.end,
        styleId: styleIdFor(range.group),
      });
    }
  };

  // paint synchronously at commit so the first frame already shows styled markdown
  useLayoutEffect(() => {
    const editor = editorRef.current;

    if (!editor) return;
    editor.editBuffer.setSyntaxStyle(markdownEditorStyle(theme).style);
    paintMarkdown(editor);
    setPosition((prior) => ({ ...prior, lineCount: editor.editBuffer.getLineCount() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useKeyboard((key) => {
    if (key.name === "escape") exitWithCurrentText();
  });

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <textarea
        ref={editorRef}
        focused
        initialValue={initialText}
        keyBindings={MARKDOWN_EDITOR_KEY_BINDINGS}
        wrapMode="word"
        cursorStyle={{ style: "block", blinking: true }}
        onSubmit={exitWithCurrentText}
        onCursorChange={(event) =>
          setPosition((prior) => ({
            ...prior,
            line: event.line + 1,
            column: event.visualColumn + 1,
          }))
        }
        onContentChange={() => {
          const editor = editorRef.current;

          if (!editor) return;
          paintMarkdown(editor);
          setPosition((prior) => ({ ...prior, lineCount: editor.editBuffer.getLineCount() }));
        }}
        style={{
          flexGrow: 1,
          backgroundColor: "transparent",
          focusedBackgroundColor: "transparent",
          textColor: theme.text,
          focusedTextColor: theme.text,
        }}
      />
      <MarkdownEditorStatus position={position} theme={theme} />
    </box>
  );
}

/** The one-row footer under the editor: caret line and column, total lines, and the save-and-close hint. */
function MarkdownEditorStatus({
  position,
  theme,
}: {
  position: MarkdownEditorPosition;
  theme: Theme;
}): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", flexShrink: 0 }}>
      <text fg={theme.textMuted}>{`Ln ${position.line}/${position.lineCount}  Col ${position.column}`}</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.textDim}>{"⌘⏎ or esc  save & close"}</text>
    </box>
  );
}
