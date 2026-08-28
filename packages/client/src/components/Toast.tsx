import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Dialog } from "./primitives/Dialog";

export interface ToastProps {
  title?: string;
  body: string;
  theme?: Theme;
}

export function Toast({ title, body, theme }: ToastProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth } = useTerminalDimensions();
  const width = Math.min(terminalWidth - 6, Math.max(28, body.length + 4));

  return (
    <Dialog
      isOpen
      title={title ? ` ${title} ` : undefined}
      width={width}
      height={6}
      background={tokens.elevated}
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
        <text fg={tokens.text}>{body}</text>
        <box style={{ flexGrow: 1 }} />
        <box style={{ flexDirection: "row" }}>
          <box style={{ flexGrow: 1 }} />
          <text fg={tokens.textDim}>[esc]</text>
        </box>
      </box>
    </Dialog>
  );
}
