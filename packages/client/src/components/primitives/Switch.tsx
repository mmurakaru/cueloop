/**
 * On/off switch: a pill with a knob that sits right (accent) when on and left
 * (dim) when off. `onToggle` unifies a mouse click and keyboard activation, so
 * the dialog grammar and a pointer both flip it.
 */

import React from "react";
import type { MouseEvent } from "@opentui/core";
import type { Theme } from "../../theme";
import { useComponentTheme } from "../theme-context";

export interface SwitchProps {
  on: boolean;
  onToggle: () => void;
  theme?: Theme;
}

export function Switch({ on, onToggle, theme }: SwitchProps): React.ReactNode {
  const tokens = useComponentTheme(theme);

  return (
    <box
      onMouseUp={(event: MouseEvent) => {
        event.stopPropagation();
        onToggle();
      }}
      style={{ flexShrink: 0 }}
    >
      <text fg={on ? tokens.accent : tokens.textDim}>{on ? "(  ●)" : "(●  )"}</text>
    </box>
  );
}
