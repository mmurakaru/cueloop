import React from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { FRAME_BORDER_STYLE } from "./primitives/frame";

export interface MenuBarProps {
  open: boolean;
  version: string;
  /** The transient status line, shown to the left of the version. */
  status?: string;
  onSettings: () => void;
  onKeybinds: () => void;
  theme?: Theme;
}

const DROPDOWN_OPTION_ROWS = 2;

export function MenuBar({
  open,
  version,
  status,
  onSettings,
  onKeybinds,
  theme,
}: MenuBarProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const dropdownHeight = DROPDOWN_OPTION_ROWS + 2;

  return (
    <>
      {open ? (
        // drops down from the top-left settings gear, below the header row
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
      ) : null}
      <box
        style={{
          flexDirection: "row",
          height: 1,
          backgroundColor: tokens.panel,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        {status ? <text fg={tokens.accent}>{status}</text> : null}
        <box style={{ flexGrow: 1 }} />
        <text fg={tokens.textDim}>v{version}</text>
      </box>
    </>
  );
}
