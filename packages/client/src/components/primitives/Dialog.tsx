/**
 * Centered modal: a full-screen layer (backdrop token, transparent by
 * default) centers a bordered, unpainted panel over the session - the frame
 * delineates the dialog, the content behind stays visible.
 * `isOpen` keeps the mount decision with the caller-visible prop vocabulary.
 */

import React from "react";
import type { Theme } from "../../theme";
import { useComponentTheme } from "../theme-context";
import { FRAME_BORDER_STYLE } from "./frame";

export interface DialogProps {
  isOpen: boolean;
  title?: string;
  width: number;
  height: number;
  /** Solid panel fill for content-heavy dialogs; default transparent. */
  background?: string;
  theme?: Theme;
  children: React.ReactNode;
}

export function Dialog({
  isOpen,
  title,
  width,
  height,
  background,
  theme,
  children,
}: DialogProps): React.ReactNode {
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
          borderStyle: FRAME_BORDER_STYLE,
          borderColor: tokens.accent,
          backgroundColor: background,
          flexDirection: "column",
        }}
        title={title}
      >
        {children}
      </box>
    </box>
  );
}
