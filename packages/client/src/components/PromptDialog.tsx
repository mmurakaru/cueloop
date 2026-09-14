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
  /** Clicking "save" commits, like pressing enter. */
  onSave?: () => void;
  /** Clicking "cancel" dismisses, like pressing esc. */
  onCancel?: () => void;
  theme?: Theme;
}

export function PromptDialog({
  isOpen,
  title,
  label,
  value,
  placeholder,
  onInput,
  onSave,
  onCancel,
  theme,
}: PromptDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth } = useTerminalDimensions();
  const inputRef = useRef<TextareaRenderable | null>(null);

  useEffect(() => {
    if (!inputRef.current) return;
    // claim focus on open so typing lands in the dialog, not whatever was focused behind it
    inputRef.current.focus();
    // open with the caret after the seeded value, like a text field
    inputRef.current.cursorOffset = value.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      title={title}
      width={Math.min(54, terminalWidth - 6)}
      height={7}
      background={tokens.elevated}
      onDismiss={onCancel}
      theme={theme}
    >
      <box
        style={{
          flexDirection: "column",
          flexGrow: 1,
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
        }}
      >
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
        <box style={{ flexDirection: "row" }}>
          <box onMouseUp={onSave} style={{ marginRight: 3 }}>
            <text fg={tokens.textDim}>enter save</text>
          </box>
          <box onMouseUp={onCancel}>
            <text fg={tokens.textDim}>esc cancel</text>
          </box>
        </box>
      </box>
    </Dialog>
  );
}
