/** Paints a raw ANSI screen (cursor-positioned text) as a terminal would, for previewing SSH surfaces. */

import React from "react";
import type { Theme } from "../theme";
import { ansiScreenToLines } from "../ansi-screen";
import { useComponentTheme } from "./theme-context";

export interface AnsiScreenProps {
  ansi: string;
  cols: number;
  rows: number;
  theme?: Theme;
}

export function AnsiScreen({ ansi, cols, rows, theme }: AnsiScreenProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const lines = ansiScreenToLines(ansi, cols, rows);

  return (
    <box style={{ flexDirection: "column" }}>
      {lines.map((line, index) => (
        <text key={index} fg={tokens.text} selectable={false} style={{ wrapMode: "none" }}>
          {line === "" ? " " : line}
        </text>
      ))}
    </box>
  );
}
