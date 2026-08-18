/**
 * A centered single-field text prompt on the shared Dialog overlay. The focused
 * input owns typing/cursor natively; the reducer's `prompt` overlay drives ⏎
 * save / esc cancel (like the composer). Used to rename an author and to ask a
 * collaborator for their name.
 */

import React, { useEffect, useRef } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Dialog } from "./primitives/Dialog";

// ⏎ submits (suppresses the textarea's default newline); the grammar owns save.
const PROMPT_KEY_BINDINGS: KeyBinding[] = [{ name: "return", action: "submit" }];

export interface PromptDialogProps {
  isOpen: boolean;
  title?: string;
  label: string;
  value: string;
  placeholder?: string;
  onInput: (text: string) => void;
  theme?: Theme;
}

export function PromptDialog({ isOpen, title, label, value, placeholder, onInput, theme }: PromptDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth } = useTerminalDimensions();
  const inputRef = useRef<TextareaRenderable | null>(null);
  useEffect(() => {
    // open with the caret after the seeded value, like a text field
    if (inputRef.current) inputRef.current.cursorOffset = value.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!isOpen) return null;
  return (
    <Dialog isOpen title={title} width={Math.min(54, terminalWidth - 6)} height={7} theme={theme}>
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1, paddingTop: 1 }}>
        <text fg={tokens.textDim}>{label}</text>
        <textarea
          ref={inputRef}
          focused
          initialValue={value}
          placeholder={placeholder}
          keyBindings={PROMPT_KEY_BINDINGS}
          onContentChange={() => onInput(inputRef.current?.plainText ?? "")}
          style={{
            height: 1,
            backgroundColor: tokens.elevated,
            focusedBackgroundColor: tokens.elevated,
            textColor: tokens.text,
            focusedTextColor: tokens.text,
          }}
        />
        <box style={{ flexGrow: 1 }} />
        <text fg={tokens.textDim}>enter save · esc cancel</text>
      </box>
    </Dialog>
  );
}
