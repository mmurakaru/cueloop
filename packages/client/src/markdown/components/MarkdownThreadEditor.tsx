/**
 * The native inline markdown editor for a thread's body: a full-height text area
 * over the working copy that lightly marks markdown as you type - a heading's
 * marker dims and its title bolds, links color, inline and fenced code gray -
 * and reports the caret line and column, replacing the external-editor hand-off so
 * editing needs no per-user editor configuration. cmd, meta, or ctrl + enter
 * saves the working copy and closes (loss-free, like the hand-off it replaces),
 * as does the header edit/normal toggle; plain enter breaks the line. Escape is
 * a no-op inside the editor, matching a modeless IDE - you leave by an explicit
 * action, not by escaping the text. The raw markdown stays visible - a concealed
 * rendered preview is a later layer.
 */

import React, {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type Theme } from "../../appearance/theme";
import { markdownHighlightRanges } from "../markdown-highlight";
import { markdownEditorStyle } from "../markdown-editor-syntax-style";

export interface MarkdownThreadEditorProps {
  initialText: string;
  theme: Theme;
  onExitEditor: (text: string) => void;
  text?: string;
  onTextChange?: (text: string) => void;
  editable?: boolean;
  mapCursor?: (offset: number) => number | undefined;
  footerHint?: string;
}

/** An imperative exit for callers outside the editor (the header edit/normal toggle): save the current text and leave. */
export interface MarkdownEditorHandle {
  requestExit: () => void;
}

// three modifiers cover terminal variance for save-and-close; plain enter is a newline, escape stays unbound
const MARKDOWN_EDITOR_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", super: true, action: "submit" },
  { name: "return", meta: true, action: "submit" },
  { name: "return", ctrl: true, action: "submit" },
  { name: "a", super: true, action: "select-all" },
  { name: "a", meta: true, action: "select-all" },
  { name: "return", action: "newline" },
  { name: "return", shift: true, action: "newline" },
];

/** The caret's 1-based line and column, plus the buffer's total line count, for the status footer. */
interface MarkdownEditorPosition {
  line: number;
  column: number;
  lineCount: number;
}

/** For each offset 0..length, the count of newlines before it, mapping a source offset to the buffer's newline-excluded offset. */
function newlinePrefixCounts(text: string): number[] {
  const counts = Array.from({ length: text.length + 1 }, () => 0);
  let seen = 0;

  for (let index = 0; index < text.length; index++) {
    counts[index] = seen;

    if (text[index] === "\n") seen += 1;
  }
  counts[text.length] = seen;

  return counts;
}

export const MarkdownThreadEditor = forwardRef<MarkdownEditorHandle, MarkdownThreadEditorProps>(
  function MarkdownThreadEditor(
    {
      initialText,
      theme,
      onExitEditor,
      text,
      onTextChange,
      editable = true,
      mapCursor,
      footerHint,
    },
    handleRef,
  ): React.ReactNode {
    const renderer = useRenderer();
    const editorRef = useRef<TextareaRenderable | null>(null);
    const reportedText = useRef(initialText);
    const [position, setPosition] = useState<MarkdownEditorPosition>({
      line: 1,
      column: 1,
      lineCount: initialText.split("\n").length,
    });

    const exitWithCurrentText = (): void =>
      onExitEditor(editorRef.current?.plainText ?? initialText);

    useImperativeHandle(handleRef, () => ({ requestExit: exitWithCurrentText }));

    const paintMarkdown = useCallback(
      (editor: TextareaRenderable): void => {
        const { styleIdFor } = markdownEditorStyle(theme, renderer.nativeScene);
        const text = editor.plainText;
        // addHighlightByCharRange counts offsets with newlines excluded, so map source offsets down by the
        // newlines before them - otherwise a highlight drifts one cell per preceding line
        const newlinesBefore = newlinePrefixCounts(text);

        editor.editBuffer.clearAllHighlights();
        for (const range of markdownHighlightRanges(text)) {
          editor.editBuffer.addHighlightByCharRange({
            start: range.start - newlinesBefore[range.start]!,
            end: range.end - newlinesBefore[range.end]!,
            styleId: styleIdFor(range.group),
          });
        }
      },
      [renderer, theme],
    );

    // paint synchronously at commit so the first frame already shows styled markdown
    useLayoutEffect(() => {
      const editor = editorRef.current;

      if (!editor) return;

      editor.editBuffer.setSyntaxStyle(markdownEditorStyle(theme, renderer.nativeScene).style);
      paintMarkdown(editor);
      setPosition((prior) => ({ ...prior, lineCount: editor.editBuffer.getLineCount() }));
    }, [paintMarkdown, renderer, theme]);

    useLayoutEffect(() => {
      const editor = editorRef.current;

      if (!editor || text === undefined || editor.plainText === text) return;

      const characterOffset = editor.editBuffer.getTextRange(0, editor.cursorOffset).length;
      const mappedOffset = mapCursor?.(characterOffset);
      const offset =
        mappedOffset === undefined
          ? editor.cursorOffset
          : editor.editBuffer.measureText(text.slice(0, mappedOffset));

      reportedText.current = text;
      editor.setText(text);
      editor.cursorOffset = Math.min(offset, editor.editBuffer.measureText(text));
      paintMarkdown(editor);
      setPosition({
        line: editor.logicalCursor.row + 1,
        column: editor.logicalCursor.col + 1,
        lineCount: editor.editBuffer.getLineCount(),
      });
    }, [text, mapCursor, paintMarkdown]);

    return (
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2 }}>
        <textarea
          ref={editorRef}
          focused={editable}
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

            const currentText = editor.plainText;

            if (currentText !== reportedText.current) {
              reportedText.current = currentText;
              onTextChange?.(currentText);
            }

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
        <MarkdownEditorStatus position={position} theme={theme} hint={footerHint} />
      </box>
    );
  },
);

/** The one-row footer under the editor: caret line and column, total lines, and the save-and-close hint. */
function MarkdownEditorStatus({
  position,
  theme,
  hint = "⌃⏎ save & close",
}: {
  position: MarkdownEditorPosition;
  theme: Theme;
  hint?: string;
}): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", flexShrink: 0 }}>
      <text
        fg={theme.textMuted}
      >{`Ln ${position.line}/${position.lineCount}  Col ${position.column}`}</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.textDim}>{hint}</text>
    </box>
  );
}
