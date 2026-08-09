/**
 * Centered modal over a dimmed backdrop. The dialog fills the terminal with
 * the backdrop token and centers a bordered panel; content composes inside.
 * `isOpen` keeps the mount decision with the caller-visible prop vocabulary.
 */

import React from "react";
import type { Theme } from "../../theme";
import { useComponentTheme } from "../theme-context";

export interface DialogProps {
  isOpen: boolean;
  title?: string;
  width: number;
  height: number;
  theme?: Theme;
  children: React.ReactNode;
}

export function Dialog({ isOpen, title, width, height, theme, children }: DialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  if (!isOpen) return null;
  return (
    <box
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        backgroundColor: tokens.backdrop,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <box
        style={{
          width,
          height,
          border: true,
          borderStyle: "rounded",
          borderColor: tokens.accent,
          backgroundColor: tokens.panel,
          flexDirection: "column",
        }}
        title={title}
      >
        {children}
      </box>
    </box>
  );
}
