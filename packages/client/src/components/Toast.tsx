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

/** A toast never spans the screen: a long message wraps inside this, like the settings dialog. */
const TOAST_MAX_WIDTH = 64;

export function Toast({ title, body, theme }: ToastProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();
  const width = Math.min(
    terminalWidth - 6,
    Math.max(28, Math.min(TOAST_MAX_WIDTH, body.length + 4)),
  );
  // the message wraps at the content width, so grow the box to fit the wrapped lines
  const contentWidth = Math.max(1, width - 4);
  const lines = body
    .split("\n")
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / contentWidth)), 0);
  const height = Math.min(terminalHeight - 4, Math.max(6, lines + 4));

  return (
    <Dialog
      isOpen
      title={title ? ` ${title} ` : undefined}
      width={width}
      height={height}
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
      </box>
    </Dialog>
  );
}
