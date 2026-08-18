import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Dialog } from "./primitives/Dialog";
import type { CheatsheetSection } from "../key-bindings";

export interface KeybindsDialogProps {
  sections: CheatsheetSection[];
  theme?: Theme;
}

export function KeybindsDialog({ sections, theme }: KeybindsDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();
  const contentRows = sections.reduce((sum, section) => sum + 1 + section.entries.length + 1, 0) + 1;
  const width = Math.min(52, terminalWidth - 6);
  const height = Math.min(terminalHeight - 4, contentRows + 3);
  return (
    <Dialog isOpen title=" keybinds " width={width} height={height} background={tokens.elevated} theme={theme}>
      <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 1, paddingRight: 1, paddingTop: 1 }}>
        {sections.map((section) => (
          <box key={section.title} style={{ flexDirection: "column" }}>
            <text fg={tokens.accent}>{section.title}</text>
            {section.entries.map((entry, index) => (
              <text key={index}>
                <span fg={tokens.text}>{entry.keys.padEnd(12)}</span>
                <span fg={tokens.textMuted}>{entry.label}</span>
              </text>
            ))}
            <text> </text>
          </box>
        ))}
        <box style={{ flexGrow: 1 }} />
        <box style={{ flexDirection: "row" }}>
          <box style={{ flexGrow: 1 }} />
          <text fg={tokens.textDim}>[esc]</text>
        </box>
      </box>
    </Dialog>
  );
}
