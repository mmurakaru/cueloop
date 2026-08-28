/**
 * A centered yes/no confirmation on the shared Dialog overlay. Presentational:
 * the key grammar (⏎ confirm, esc cancel) is driven by the reducer; the buttons
 * carry the same intents for the mouse. Used for destructive actions like the
 * inbox delete.
 */

import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Dialog } from "./primitives/Dialog";
import { Button } from "./primitives/Button";
import { Toolbar } from "./primitives/Toolbar";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  theme?: Theme;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  theme,
}: ConfirmDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth } = useTerminalDimensions();

  if (!isOpen) return null;

  return (
    <Dialog isOpen title={title} width={Math.min(54, terminalWidth - 6)} height={7} theme={theme}>
      <box
        style={{
          flexDirection: "column",
          flexGrow: 1,
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
        }}
      >
        <text fg={tokens.text}>{message}</text>
        <box style={{ flexGrow: 1 }} />
        <Toolbar>
          <Button variant="solid" onPress={onConfirm} theme={theme}>
            {` ${confirmLabel} `}
          </Button>
          <Button onPress={onCancel} theme={theme}>
            {` ${cancelLabel} esc `}
          </Button>
        </Toolbar>
      </box>
    </Dialog>
  );
}
