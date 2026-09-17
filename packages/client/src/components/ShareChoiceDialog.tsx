/**
 * The share public/private choice, as an app-level overlay the share shortcut
 * opens from any view. Public publishes a link for anyone; private opens the
 * manage-access allowlist surface. The header share button and the shortcut both
 * open this one surface. Selection moves with the keyboard (owned by the App) or
 * a pointer click on a row.
 */

import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Dialog } from "./primitives/Dialog";

export type ShareChoice = "public" | "private";

interface ShareChoiceRow {
  choice: ShareChoice;
  label: string;
}

export const SHARE_CHOICES: ShareChoiceRow[] = [
  { choice: "public", label: "public link" },
  { choice: "private", label: "private link" },
];

export interface ShareChoiceDialogProps {
  isOpen: boolean;
  /** The highlighted row; the App drives it from the shareChoice mode. */
  selectedIndex: number;
  /** Publish a public link and copy its connection line. */
  onPublicShare: () => void;
  /** Open the private-share manage-access allowlist surface. */
  onPrivateShare: () => void;
  onClose: () => void;
  theme?: Theme;
}

export function ShareChoiceDialog({
  isOpen,
  selectedIndex,
  onPublicShare,
  onPrivateShare,
  onClose,
  theme,
}: ShareChoiceDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth } = useTerminalDimensions();

  const pick = (choice: ShareChoice): void => {
    onClose();
    if (choice === "public") onPublicShare();
    else onPrivateShare();
  };

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      title=" Share "
      width={Math.min(46, terminalWidth - 6)}
      height={7}
      background={tokens.elevated}
      onDismiss={onClose}
      theme={theme}
    >
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
        {SHARE_CHOICES.map((row, index) => (
          <box key={row.choice} onMouseUp={() => pick(row.choice)} style={{ flexDirection: "row" }}>
            <text fg={index === selectedIndex ? tokens.accent : tokens.text}>
              {index === selectedIndex ? "› " : "  "}
              {row.label}
            </text>
          </box>
        ))}
        <box style={{ flexGrow: 1 }} />
        <text fg={tokens.textDim}>↑↓ choose · enter select · esc cancel</text>
      </box>
    </Dialog>
  );
}
