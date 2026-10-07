/**
 * Word-button: a pressable label. `onPress` unifies mouse and (future)
 * keyboard activation; `isDisabled` swallows presses without changing the
 * rendered label, so read-only affordances keep their place in the layout.
 */

import React from "react";
import type { MouseEvent } from "@opentui/core";
import type { Theme } from "../../../appearance/theme";
import { useComponentTheme } from "../../../appearance/components/theme-context";

export interface ButtonProps {
  onPress: () => void;
  isDisabled?: boolean;
  variant?: "solid" | "plain" | "accent-text";
  foreground?: string;
  marginRight?: number;
  theme?: Theme;
  children: string;
}

export function Button({
  onPress,
  isDisabled = false,
  variant = "plain",
  foreground: foregroundOverride,
  marginRight,
  theme,
  children,
}: ButtonProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  // a disabled solid button reads as muted, so it never looks like a live call to action
  const backgroundColor =
    variant === "solid" ? (isDisabled ? tokens.border : tokens.accent) : undefined;
  const foreground =
    foregroundOverride ??
    (variant === "solid"
      ? isDisabled
        ? tokens.textMuted
        : tokens.accentInk
      : variant === "accent-text"
        ? tokens.accent
        : tokens.textDim);

  return (
    <box
      style={{ backgroundColor, marginRight }}
      onMouseUp={(event: MouseEvent) => {
        // Consume the press so it never bubbles to an ancestor's onMouseUp (e.g. a card).
        event.stopPropagation();

        if (!isDisabled) onPress();
      }}
    >
      <text fg={foreground}>{children}</text>
    </box>
  );
}
