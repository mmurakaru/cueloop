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

/** Rows a section takes: its title, its entries, and the blank line after it. */
function sectionRows(section: CheatsheetSection): number {
  return 1 + section.entries.length + 1;
}

/**
 * Split the sections over `count` columns, filling each column to the
 * balanced share of rows before starting the next, so a long cheatsheet
 * reads top to bottom, then left to right.
 */
function columnsOf(sections: CheatsheetSection[], count: number): CheatsheetSection[][] {
  const total = sections.reduce((sum, section) => sum + sectionRows(section), 0);
  const share = Math.ceil(total / count);
  const columns: CheatsheetSection[][] = [[]];
  let filled = 0;

  for (const section of sections) {
    const column = columns[columns.length - 1]!;

    if (filled > 0 && filled + sectionRows(section) > share && columns.length < count) {
      columns.push([section]);
      filled = sectionRows(section);
    } else {
      column.push(section);
      filled += sectionRows(section);
    }
  }

  return columns;
}

const COLUMN_WIDTH = 48;

export function KeybindsDialog({ sections, theme }: KeybindsDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();
  const totalRows = sections.reduce((sum, section) => sum + sectionRows(section), 0) + 1;
  // a cheatsheet taller than the terminal folds into a second column
  const columnCount =
    totalRows + 3 > terminalHeight - 4 && terminalWidth >= COLUMN_WIDTH * 2 + 6 ? 2 : 1;
  const columns = columnsOf(sections, columnCount);
  const tallest = Math.max(
    ...columns.map((column) => column.reduce((sum, section) => sum + sectionRows(section), 0)),
  );
  const width = Math.min(COLUMN_WIDTH * columnCount + 4, terminalWidth - 6);
  const height = Math.min(terminalHeight - 4, tallest + 1 + 3);

  return (
    <Dialog
      isOpen
      title=" keybinds "
      width={width}
      height={height}
      background={tokens.elevated}
      theme={theme}
    >
      <box
        style={{
          flexDirection: "column",
          flexGrow: 1,
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
        }}
      >
        <box style={{ flexDirection: "row", flexGrow: 1 }}>
          {columns.map((column, columnIndex) => (
            <box key={columnIndex} style={{ flexDirection: "column", width: COLUMN_WIDTH }}>
              {column.map((section) => (
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
            </box>
          ))}
        </box>
        <box style={{ flexDirection: "row" }}>
          <box style={{ flexGrow: 1 }} />
          <text fg={tokens.textDim}>[esc]</text>
        </box>
      </box>
    </Dialog>
  );
}
