// The app shell's top bar: a left icon cluster + label, a center title, and right tabs + action icons.

import React from "react";
import { DARK, type Theme } from "../theme";

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
  theme?: Theme;
}

export function ShellHeader({
  leftIcons = [],
  leftLabel,
  titleIcon,
  title,
  tabs = [],
  rightIcons = [],
  theme,
}: ShellHeaderProps): React.ReactNode {
  const tokens = theme ?? DARK;

  return (
    <box style={{ flexDirection: "row", height: 1, paddingLeft: 1, paddingRight: 1 }}>
      {leftIcons.map((glyph, index) => (
        <text key={`left-${index}-${glyph}`} fg={tokens.textMuted}>
          {glyph}{" "}
        </text>
      ))}
      {leftLabel !== undefined ? <text fg={tokens.textMuted}>{leftLabel}</text> : null}
      <box style={{ flexGrow: 1 }} />
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
          {" "}
          {glyph}
        </text>
      ))}
    </box>
  );
}
