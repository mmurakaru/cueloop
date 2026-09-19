/**
 * A tag-style input for GitHub logins: each added handle is an inline chip with
 * a hover × to remove, and a trailing one-line field where enter adds the next
 * and backspace on an empty field drops the last. Controlled - the caller owns
 * the list and receives every change.
 */

import React, { useEffect, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { NERD } from "./primitives/icons";

// enter adds the handle rather than inserting a newline into the one-line field
const ADD_KEY_BINDINGS: KeyBinding[] = [{ name: "return", action: "submit" }];

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
      style={{
        flexDirection: "row",
        flexShrink: 0,
        marginRight: 2,
        paddingLeft: 1,
        backgroundColor: tokens.border,
      }}
    >
      <text fg={tokens.text} style={{ wrapMode: "none" }}>{`@${login}`}</text>
      <box
        onMouseUp={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        style={{ paddingLeft: 1, paddingRight: 1 }}
      >
        <text fg={tokens.textDim}>{hovered ? NERD.close : " "}</text>
      </box>
    </box>
  );
}

export interface HandleChipsInputProps {
  logins: string[];
  onChange: (logins: string[]) => void;
  /** Whether this field owns the cursor and backspace; false shows the chips without a blinking caret. */
  focused?: boolean;
  /** Fired on backspace when the field is empty and no chips remain, so the caller can collapse the section. */
  onEmptyBackspace?: () => void;
  theme?: Theme;
}

export function HandleChipsInput({
  logins,
  onChange,
  focused = true,
  onEmptyBackspace,
  theme,
}: HandleChipsInputProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const inputRef = useRef<TextareaRenderable | null>(null);
  // the text the current field generation mounts with; a remount reseeds it
  const [seed, setSeed] = useState("");
  const [inputGeneration, setInputGeneration] = useState(0);

  useEffect(() => {
    const input = inputRef.current;

    if (!input || !focused) return;
    input.focus();
    input.cursorOffset = seed.length; // land the caret at the end of the seeded text
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputGeneration, focused]);

  const reseed = (text: string): void => {
    setSeed(text);
    setInputGeneration((generation) => generation + 1);
  };

  const addDraft = (): void => {
    const handle = (inputRef.current?.plainText ?? "").trim().replace(/^@/, "").toLowerCase();

    if (handle && !logins.includes(handle)) onChange([...logins, handle]);
    reseed("");
  };

  useKeyboard((key) => {
    if (!focused) return;
    if (key.name !== "backspace" || (inputRef.current?.plainText ?? "").length > 0) return;
    // backspace on an empty field pulls the last chip back in to edit; with none left, collapse
    if (logins.length > 0) {
      const last = logins[logins.length - 1]!;

      onChange(logins.slice(0, -1));
      reseed(last);
    } else {
      onEmptyBackspace?.();
    }
  });

  return (
    <box style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
      {logins.map((login) => (
        <HandleChip
          key={login}
          login={login}
          onRemove={() => onChange(logins.filter((entry) => entry !== login))}
          tokens={tokens}
        />
      ))}
      <box style={{ flexDirection: "row", flexShrink: 0 }}>
        <text fg={tokens.textDim}>{"@"}</text>
        <textarea
          key={inputGeneration}
          ref={inputRef}
          focused
          initialValue={seed}
          placeholder="handle"
          keyBindings={ADD_KEY_BINDINGS}
          onSubmit={addDraft}
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
  );
}
