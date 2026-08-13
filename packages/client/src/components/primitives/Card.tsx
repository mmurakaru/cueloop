/**
 * Bordered rounded box with an optional title. The card owns the
 * height-derivation rule: its height is always the declared content row
 * count plus the two border rows, so layout math and the mounted box can
 * never drift apart - border-collapse bugs die here.
 */

import React from "react";
import type { Theme } from "../../theme";
import { useComponentTheme } from "../theme-context";
import { FRAME_BORDER_STYLE } from "./frame";

export interface CardProps {
  title?: string;
  /** Number of content rows inside the border; the box adds the two border rows. */
  contentRows: number;
  borderColor?: string;
  backgroundColor?: string;
  marginLeft?: number;
  marginRight?: number;
  theme?: Theme;
  children: React.ReactNode;
}

/** The one height rule: content rows plus the top and bottom border rows. */
export function cardHeight(contentRows: number): number {
  return contentRows + 2;
}

export function Card({
  title,
  contentRows,
  borderColor,
  backgroundColor,
  marginLeft,
  marginRight,
  theme,
  children,
}: CardProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <box
      style={{
        height: cardHeight(contentRows),
        marginLeft,
        marginRight,
        border: true,
        borderStyle: FRAME_BORDER_STYLE,
        borderColor: borderColor ?? tokens.border,
        backgroundColor: backgroundColor ?? tokens.elevated,
        flexDirection: "column",
        paddingLeft: 1,
      }}
      title={title}
    >
      {children}
    </box>
  );
}
