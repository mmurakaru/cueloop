/**
 * Owner surface for a private share's allowlist: the GitHub logins allowed to
 * open the private link. Handles are a local draft here - add or remove them
 * freely; nothing persists until create publishes the link, so closing discards
 * the draft and no handles survive a cancel.
 */

import React, { useEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useTerminalDimensions } from "@opentui/react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Dialog } from "./primitives/Dialog";
import { DialogActions } from "./primitives/DialogActions";
import { NERD } from "./primitives/icons";

// enter adds the handle rather than inserting a newline into the one-line field
const ADD_KEY_BINDINGS: KeyBinding[] = [{ name: "return", action: "submit" }];

/** An allowed handle as an inline chip; hovering reveals an × to remove it, like a file tab. */
function HandleChip({
  login,
  onRemove,
  tokens,
}: {
  login: string;
  onRemove: () => void;
  tokens: Theme;
}): React.ReactNode {
  const [hovered, setHovered] = useState(false);

  return (
    <box
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      style={{ flexDirection: "row", flexShrink: 0, marginRight: 2, backgroundColor: tokens.panel }}
    >
      <text fg={tokens.text} style={{ wrapMode: "none" }}>{`@${login}`}</text>
      <box
        onMouseUp={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        style={{ paddingLeft: 1 }}
      >
        <text fg={tokens.textDim}>{hovered ? NERD.close : " "}</text>
      </box>
    </box>
  );
}

export interface ManageAccessDialogProps {
  isOpen: boolean;
  /** The allowlist to seed the draft with; edits stay local until create. */
  initialLogins: string[];
  /** Publish the private link with this allowlist and copy its connection line. */
  onCreate: (logins: string[]) => void;
  onClose: () => void;
  theme?: Theme;
}

export function ManageAccessDialog({
  isOpen,
  initialLogins,
  onCreate,
  onClose,
  theme,
}: ManageAccessDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth } = useTerminalDimensions();
  const inputRef = useRef<TextareaRenderable | null>(null);
  const [logins, setLogins] = useState(initialLogins);
  const [draft, setDraft] = useState("");
  const [inputGeneration, setInputGeneration] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputGeneration]);

  const addDraft = (): void => {
    const handle = draft.trim().replace(/^@/, "").toLowerCase();

    if (handle && !logins.includes(handle)) setLogins((current) => [...current, handle]);
    setDraft("");
    setInputGeneration((generation) => generation + 1);
  };
  const removeLogin = (login: string): void =>
    setLogins((current) => current.filter((entry) => entry !== login));

  useKeyboard((key) => {
    if (!isOpen) return;
    if (key.name === "escape") return onClose();
    // backspace on an empty input drops the last chip, like a tag field
    if (key.name === "backspace" && (inputRef.current?.plainText ?? "").length === 0) {
      setLogins((current) => (current.length > 0 ? current.slice(0, -1) : current));
    }
  });

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      title=" Manage access "
      width={Math.min(48, terminalWidth - 6)}
      height={7}
      background={tokens.elevated}
      onDismiss={onClose}
      theme={theme}
    >
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        <text fg={tokens.textDim}>Add GitHub handles of collaborators</text>
        <box style={{ flexGrow: 1 }} />
        {/* chips and the input share one wrapping row: type, enter to add the next chip inline */}
        <box style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
          {logins.map((login) => (
            <HandleChip
              key={login}
              login={login}
              onRemove={() => removeLogin(login)}
              tokens={tokens}
            />
          ))}
          <box style={{ flexDirection: "row", flexShrink: 0 }}>
            <text fg={tokens.textDim}>{"@"}</text>
            <textarea
              key={inputGeneration}
              ref={inputRef}
              focused
              placeholder="handle"
              keyBindings={ADD_KEY_BINDINGS}
              onSubmit={addDraft}
              onContentChange={() => setDraft(inputRef.current?.plainText ?? "")}
              style={{
                height: 1,
                width: 16,
                backgroundColor: tokens.elevated,
                focusedBackgroundColor: tokens.elevated,
                textColor: tokens.text,
                focusedTextColor: tokens.text,
              }}
            />
          </box>
        </box>
        <box style={{ flexGrow: 1 }} />
        <DialogActions
          confirmLabel="create"
          onConfirm={() => onCreate(logins)}
          onCancel={onClose}
          theme={theme}
        />
      </box>
    </Dialog>
  );
}
