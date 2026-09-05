// A clickable single-glyph button for header and footer controls: an icon in a
// box that calls onPress, painted in the brand accent when active. alignSelf
// center keeps it on the same row as sibling text or icons.

import React from "react";
import type { MouseEvent as TerminalMouseEvent } from "@opentui/core";
import { DARK, type Theme } from "../../theme";

export interface IconButtonProps {
  glyph: string;
  onPress?: () => void;
  /** Paint the glyph in the brand accent to mark the current mode or view. */
  active?: boolean;
  /** Dim the glyph and ignore presses. */
  disabled?: boolean;
  /** Override the resolved foreground (wins over active/disabled colouring). */
  color?: string;
  marginLeft?: number;
  marginRight?: number;
  theme?: Theme;
}

export function IconButton({
  glyph,
  onPress,
  active,
  disabled,
  color,
  marginLeft,
  marginRight,
  theme,
}: IconButtonProps): React.ReactNode {
  const tokens = theme ?? DARK;
  const resolved = color ?? (disabled ? tokens.textDim : active ? tokens.accent : tokens.textMuted);
  // a button press is its own action - never let it bubble to a clickable row behind it
  const handleMouseUp = (event: TerminalMouseEvent): void => {
    event.stopPropagation();
    onPress?.();
  };

  return (
    <box
      onMouseUp={disabled ? undefined : handleMouseUp}
      style={{ alignSelf: "center", marginLeft, marginRight }}
    >
      <text fg={resolved}>{glyph}</text>
    </box>
  );
}
