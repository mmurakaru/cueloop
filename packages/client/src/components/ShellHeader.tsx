// The app shell's top bar: left panel toggle + icons + label, a center title, right tabs + icons + panel toggle.

import React from "react";
import { DARK, type Theme } from "../theme";
import { NERD } from "./primitives/icons";

export interface ShellTab {
  label: string;
  active?: boolean;
}

export interface ShellHeaderProps {
  leftIcons?: readonly string[];
  leftLabel?: string;
  titleIcon?: string;
  title?: string;
  tabs?: readonly ShellTab[];
  rightIcons?: readonly string[];
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
  theme?: Theme;
}

function ToggleButton({
  glyph,
  onPress,
  color,
}: {
  glyph: string;
  onPress: () => void;
  color: string;
}): React.ReactNode {
  return (
    <box onMouseUp={onPress}>
      <text fg={color}>{glyph} </text>
    </box>
  );
}

export function ShellHeader({
  leftIcons = [],
  leftLabel,
  titleIcon,
  title,
  tabs = [],
  rightIcons = [],
  sidebarOpen = true,
  onToggleSidebar,
  inspectorOpen = true,
  onToggleInspector,
  theme,
}: ShellHeaderProps): React.ReactNode {
  const tokens = theme ?? DARK;

  return (
    <box style={{ flexDirection: "row", height: 1, paddingLeft: 1, paddingRight: 1 }}>
      {onToggleSidebar !== undefined ? (
        <ToggleButton
          glyph={sidebarOpen ? NERD.sidebarLeft : NERD.sidebarLeftOff}
          onPress={onToggleSidebar}
          color={tokens.textMuted}
        />
      ) : null}
      {leftIcons.map((glyph, index) => (
        <text key={`left-${index}-${glyph}`} fg={tokens.textMuted}>
          {glyph}{" "}
        </text>
      ))}
      {leftLabel !== undefined ? (
        <text fg={tokens.textMuted}>
          {leftLabel}
          {"  "}
        </text>
      ) : null}
      {titleIcon !== undefined ? <text fg={tokens.textDim}>{titleIcon} </text> : null}
      {title !== undefined ? <text fg={tokens.text}>{title}</text> : null}
      <box style={{ flexGrow: 1 }} />
      {tabs.map((tab, index) => (
        <text key={`tab-${index}-${tab.label}`} fg={tab.active ? tokens.accent : tokens.textMuted}>
          {tab.label}
          {"  "}
        </text>
      ))}
      {rightIcons.map((glyph, index) => (
        <text key={`right-${index}-${glyph}`} fg={tokens.textMuted}>
          {glyph}{" "}
        </text>
      ))}
      {onToggleInspector !== undefined ? (
        <ToggleButton
          glyph={inspectorOpen ? NERD.sidebarRight : NERD.sidebarRightOff}
          onPress={onToggleInspector}
          color={tokens.textMuted}
        />
      ) : null}
    </box>
  );
}
