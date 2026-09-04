// The app shell's top bar: left panel toggle + icons + label, an optional title, right icons + panel toggle.

import React from "react";
import { DARK, type Theme } from "../theme";
import { NERD } from "./primitives/icons";

export interface ShellTab {
  label: string;
  active?: boolean;
}

// A header icon; active paints it in the brand accent to mark the current view or mode.
export interface ShellIcon {
  glyph: string;
  active?: boolean;
  onPress?: () => void;
}

export interface ShellHeaderProps {
  leftIcons?: readonly ShellIcon[];
  leftLabel?: string;
  titleIcon?: string;
  title?: string;
  tabs?: readonly ShellTab[];
  rightIcons?: readonly ShellIcon[];
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
  theme?: Theme;
}

function IconView({
  icon,
  tokens,
  marginRight,
}: {
  icon: ShellIcon;
  tokens: Theme;
  marginRight: number;
}): React.ReactNode {
  const color = icon.active ? tokens.accent : tokens.textMuted;

  // alignSelf center keeps the clickable box on the same row as sibling icons
  return (
    <box onMouseUp={icon.onPress} style={{ alignSelf: "center", marginRight }}>
      <text fg={color}>{icon.glyph}</text>
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
    <box
      style={{
        flexDirection: "row",
        height: "100%",
        alignItems: "center",
        paddingLeft: 2,
        paddingRight: 2,
      }}
    >
      <box style={{ flexDirection: "row", alignItems: "center" }}>
        {onToggleSidebar !== undefined ? (
          <IconView
            icon={{
              glyph: sidebarOpen ? NERD.sidebarLeft : NERD.sidebarLeftOff,
              onPress: onToggleSidebar,
            }}
            tokens={tokens}
            marginRight={3}
          />
        ) : null}
        {leftIcons.map((icon, index) => (
          <IconView
            key={`left-${index}-${icon.glyph}`}
            icon={icon}
            tokens={tokens}
            marginRight={3}
          />
        ))}
        {leftLabel !== undefined ? (
          <text fg={tokens.textMuted}>
            {leftLabel}
            {"  "}
          </text>
        ) : null}
        {titleIcon !== undefined ? <text fg={tokens.textDim}>{titleIcon} </text> : null}
        {title !== undefined ? <text fg={tokens.text}>{title}</text> : null}
      </box>
      <box style={{ flexGrow: 1 }} />
      <box style={{ flexDirection: "row", alignItems: "center" }}>
        {tabs.map((tab, index) => (
          <text
            key={`tab-${index}-${tab.label}`}
            fg={tab.active ? tokens.accent : tokens.textMuted}
          >
            {tab.label}
            {"   "}
          </text>
        ))}
        {rightIcons.map((icon, index) => (
          <IconView
            key={`right-${index}-${icon.glyph}`}
            icon={icon}
            tokens={tokens}
            marginRight={3}
          />
        ))}
        {onToggleInspector !== undefined ? (
          <IconView
            icon={{
              glyph: inspectorOpen ? NERD.sidebarRight : NERD.sidebarRightOff,
              onPress: onToggleInspector,
            }}
            tokens={tokens}
            marginRight={0}
          />
        ) : null}
      </box>
    </box>
  );
}
