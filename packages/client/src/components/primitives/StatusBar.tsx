/**
 * One-row panel bar for the status/hint line. Content renders as dim text;
 * callers pass richer spans as children when a segment needs another tone.
 */

import React from "react";
import type { Theme } from "../../theme";
import { useComponentTheme } from "../theme-context";

export interface StatusBarProps {
  theme?: Theme;
  children: React.ReactNode;
}

export function StatusBar({ theme, children }: StatusBarProps): React.ReactNode {
  const tokens = useComponentTheme(theme);

  return (
    <box style={{ height: 1, backgroundColor: tokens.panel, paddingLeft: 1 }}>
      <text fg={tokens.textDim}>{children}</text>
    </box>
  );
}
