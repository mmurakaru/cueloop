/**
 * Typed settings rows for the settings dialog: toggle (on/off), cycle
 * (enumerated options), and text (freeform value). Every row is one line -
 * label column left, value right - and presses go through `onPress` so mouse
 * and keyboard activation share one path.
 */

import React from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";

export interface SettingsRowDescriptor {
  key: string;
  label: string;
  kind: "toggle" | "cycle" | "text";
  options?: string[];
  hint?: string;
}

interface RowShellProps {
  label: string;
  isActive: boolean;
  onPress: () => void;
  theme?: Theme;
  children: React.ReactNode;
}

function RowShell({ label, isActive, onPress, theme, children }: RowShellProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <box
      style={{ flexDirection: "row", height: 1, backgroundColor: isActive ? tokens.border : undefined }}
      onMouseUp={onPress}
    >
      <box style={{ width: 26, paddingLeft: 1 }}>
        <text fg={isActive ? tokens.text : tokens.textMuted}>{label}</text>
      </box>
      {children}
    </box>
  );
}

export interface ToggleRowProps {
  label: string;
  value: boolean;
  isActive: boolean;
  onPress: () => void;
  theme?: Theme;
}

export function ToggleRow({ label, value, isActive, onPress, theme }: ToggleRowProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <RowShell label={label} isActive={isActive} onPress={onPress} theme={theme}>
      <text fg={value ? tokens.green : tokens.accent}>{value ? "on" : "off"}</text>
    </RowShell>
  );
}

export interface CycleRowProps {
  label: string;
  value: string;
  isActive: boolean;
  onPress: () => void;
  theme?: Theme;
}

export function CycleRow({ label, value, isActive, onPress, theme }: CycleRowProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <RowShell label={label} isActive={isActive} onPress={onPress} theme={theme}>
      <text fg={tokens.accent}>{value}</text>
    </RowShell>
  );
}

export interface TextRowProps {
  label: string;
  value: string;
  isActive: boolean;
  onPress: () => void;
  theme?: Theme;
}

export function TextRow({ label, value, isActive, onPress, theme }: TextRowProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <RowShell label={label} isActive={isActive} onPress={onPress} theme={theme}>
      <text fg={tokens.accent}>{value}</text>
    </RowShell>
  );
}
