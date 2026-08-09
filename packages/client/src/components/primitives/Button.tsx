/**
 * Word-button: a pressable label. `onPress` unifies mouse and (future)
 * keyboard activation; `isDisabled` swallows presses without changing the
 * rendered label, so read-only affordances keep their place in the layout.
 */

import React from "react";
import type { Theme } from "../../theme";
import { useComponentTheme } from "../theme-context";

export interface ButtonProps {
  /** Unified activation: mouse release today, keyboard activation tomorrow. */
  onPress: () => void;
  isDisabled?: boolean;
  /** solid = accent-filled call to action; plain = quiet word-button. */
  variant?: "solid" | "plain" | "accent-text";
  marginRight?: number;
  theme?: Theme;
  children: string;
}

export function Button({
  onPress,
  isDisabled = false,
  variant = "plain",
  marginRight,
  theme,
  children,
}: ButtonProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const backgroundColor = variant === "solid" ? tokens.accent : undefined;
  const foreground =
    variant === "solid" ? tokens.accentInk : variant === "accent-text" ? tokens.accent : tokens.textDim;
  return (
    <box
      style={{ backgroundColor, marginRight }}
      onMouseUp={() => {
        if (!isDisabled) onPress();
      }}
    >
      <text fg={foreground}>{children}</text>
    </box>
  );
}
