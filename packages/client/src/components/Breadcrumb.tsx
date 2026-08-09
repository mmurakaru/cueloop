/**
 * One-row breadcrumb trail: toned segments joined by " · " on the panel
 * surface. The app header is a breadcrumb (product · artifact · revision)
 * followed by state badges; each item picks a semantic tone.
 */

import React from "react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";

export type BreadcrumbTone = "accent" | "dim" | "text" | "green";

export interface BreadcrumbItem {
  label: string;
  tone?: BreadcrumbTone;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  theme?: Theme;
}

export function Breadcrumb({ items, theme }: BreadcrumbProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const toneColor = (tone?: BreadcrumbTone): string =>
    tone === "accent" ? tokens.accent : tone === "green" ? tokens.green : tone === "text" ? tokens.text : tokens.textDim;
  return (
    <box style={{ height: 1, backgroundColor: tokens.panel, paddingLeft: 1, flexDirection: "row" }}>
      <text fg={tokens.text}>
        {items.map((item, index) => (
          <span key={index} fg={toneColor(item.tone)}>
            {index === 0 ? item.label : ` · ${item.label}`}
          </span>
        ))}
      </text>
    </box>
  );
}
