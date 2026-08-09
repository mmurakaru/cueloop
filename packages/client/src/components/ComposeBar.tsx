/**
 * Bottom compose bar - the diff view composes annotation bodies here. The
 * editor is the same multiline textarea contract as the inline composer:
 * ⏎ saves through the grammar, shift+⏎ adds a line.
 */

import React, { useRef } from "react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { truncateToSingleLine } from "./truncate-text";

export interface ComposeBarProps {
  kind: "comment" | "suggestion";
  quote: string;
  text: string;
  onInput: (text: string) => void;
  theme?: Theme;
}

const COMPOSE_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
];

export function ComposeBar({ kind, quote, text, onInput, theme }: ComposeBarProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const editorRef = useRef<TextareaRenderable | null>(null);
  const editorRows = Math.min(4, Math.max(1, text.split("\n").length));
  return (
    <box style={{ height: 1 + editorRows, backgroundColor: tokens.elevated, flexDirection: "column", paddingLeft: 1 }}>
      <text fg={kind === "suggestion" ? tokens.green : tokens.accent}>
        {kind === "suggestion" ? "SUGGEST REPLACEMENT FOR" : "COMMENT ON"} “{truncateToSingleLine(quote, 60)}” · ⏎ save · esc cancel
      </text>
      <textarea
        ref={editorRef}
        focused
        initialValue=""
        keyBindings={COMPOSE_KEY_BINDINGS}
        onContentChange={() => {
          const editor = editorRef.current;
          if (editor) onInput(editor.plainText);
        }}
        style={{
          height: editorRows,
          backgroundColor: tokens.elevated,
          focusedBackgroundColor: tokens.elevated,
          textColor: tokens.text,
          focusedTextColor: tokens.text,
        }}
      />
    </box>
  );
}
