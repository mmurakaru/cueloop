import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { FRAME_BORDER_STYLE } from "./primitives/frame";

export interface MenuBarProps {
  open: boolean;
  version: string;
  /** The transient status line, shown between the menu and the version. */
  status?: string;
  onToggle: () => void;
  onSettings: () => void;
  onKeybinds: () => void;
  theme?: Theme;
}

const DROPUP_OPTION_ROWS = 2;

export function MenuBar({ open, version, status, onToggle, onSettings, onKeybinds, theme }: MenuBarProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { height: terminalHeight } = useTerminalDimensions();
  const dropupHeight = DROPUP_OPTION_ROWS + 2;
  return (
    <>
      {open ? (
        <box
          style={{
            position: "absolute",
            left: 1,
            top: Math.max(0, terminalHeight - 1 - dropupHeight),
            width: 16,
            height: dropupHeight,
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
      ) : null}
      <box style={{ flexDirection: "row", height: 1, backgroundColor: tokens.panel, paddingLeft: 1, paddingRight: 1 }}>
        <box onMouseUp={onToggle}>
          <text fg={tokens.textDim}>{open ? "menu ▾" : "menu ▴"}</text>
        </box>
        {status ? <text fg={tokens.accent}>{`  ${status}`}</text> : null}
        <box style={{ flexGrow: 1 }} />
        <text fg={tokens.textDim}>v{version}</text>
      </box>
    </>
  );
}
