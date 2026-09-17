/**
 * Owner surface for a private share's allowlist: the GitHub logins allowed to
 * open the private link. Type a handle and add it; click a row to remove one.
 * Editing persists through the controller, so the list survives a reload.
 */

import React, { useEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useTerminalDimensions } from "@opentui/react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Dialog } from "./primitives/Dialog";

// enter adds the handle rather than inserting a newline into the one-line field
const ADD_KEY_BINDINGS: KeyBinding[] = [{ name: "return", action: "submit" }];

export interface ManageAccessDialogProps {
  isOpen: boolean;
  logins: string[];
  onAdd: (login: string) => void;
  onRemove: (login: string) => void;
  onClose: () => void;
  theme?: Theme;
}

export function ManageAccessDialog({
  isOpen,
  logins,
  onAdd,
  onRemove,
  onClose,
  theme,
}: ManageAccessDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth } = useTerminalDimensions();
  const inputRef = useRef<TextareaRenderable | null>(null);
  const [draft, setDraft] = useState("");
  const [inputGeneration, setInputGeneration] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputGeneration]);

  const addDraft = (): void => {
    const handle = draft.trim().replace(/^@/, "").toLowerCase();

    if (handle && !logins.includes(handle)) onAdd(handle);
    setDraft("");
    setInputGeneration((generation) => generation + 1);
  };

  useKeyboard((key) => {
    if (isOpen && key.name === "escape") onClose();
  });

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      title=" Manage access "
      width={Math.min(54, terminalWidth - 6)}
      height={Math.min(18, 9 + logins.length)}
      background={tokens.elevated}
      onDismiss={onClose}
      theme={theme}
    >
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <text fg={tokens.textDim}>Only these GitHub users can open the private link.</text>
        <box style={{ height: 1 }} />
        {logins.length === 0 ? (
          <text fg={tokens.textDim}>no one yet - add a handle below</text>
        ) : (
          logins.map((login) => (
            <box key={login} onMouseUp={() => onRemove(login)} style={{ flexDirection: "row" }}>
              <text fg={tokens.text}>{`@${login}`}</text>
              <box style={{ flexGrow: 1 }} />
              <text fg={tokens.textDim}>remove</text>
            </box>
          ))
        )}
        <box style={{ flexGrow: 1 }} />
        <box style={{ flexDirection: "row" }}>
          <text fg={tokens.textDim}>{"@"}</text>
          <textarea
            key={inputGeneration}
            ref={inputRef}
            focused
            placeholder="handle"
            keyBindings={ADD_KEY_BINDINGS}
            onContentChange={() => setDraft(inputRef.current?.plainText ?? "")}
            style={{
              height: 1,
              flexGrow: 1,
              backgroundColor: tokens.elevated,
              focusedBackgroundColor: tokens.elevated,
              textColor: tokens.text,
              focusedTextColor: tokens.text,
            }}
          />
        </box>
        <box style={{ flexDirection: "row" }}>
          <box onMouseUp={addDraft} style={{ marginRight: 3 }}>
            <text fg={tokens.accent}>add</text>
          </box>
          <box onMouseUp={onClose}>
            <text fg={tokens.textDim}>close</text>
          </box>
        </box>
      </box>
    </Dialog>
  );
}
