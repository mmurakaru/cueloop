import React from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { FRAME_BORDER_STYLE } from "./primitives/frame";

export interface MenuBarProps {
  open: boolean;
  onSettings: () => void;
  onKeybinds: () => void;
  theme?: Theme;
}

const DROPDOWN_OPTION_ROWS = 2;

/** The settings gear's drop-down: Settings and Keybinds, below the top-left gear. */
export function MenuBar({ open, onSettings, onKeybinds, theme }: MenuBarProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const dropdownHeight = DROPDOWN_OPTION_ROWS + 2;

  if (!open) return null;

  return (
    <box
      style={{
        position: "absolute",
        left: 1,
        top: 2,
        width: 16,
        height: dropdownHeight,
        border: true,
        borderStyle: FRAME_BORDER_STYLE,
        borderColor: tokens.text,
        flexDirection: "column",
      }}
    >
      <box onMouseUp={onSettings}>
        <text fg={tokens.text}> Settings</text>
      </box>
      <box onMouseUp={onKeybinds}>
        <text fg={tokens.text}> Keybinds</text>
      </box>
    </box>
  );
}
