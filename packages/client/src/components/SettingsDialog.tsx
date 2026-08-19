/**
 * The settings overlay, promoted from the design prototype: a centered
 * Dialog with a left category nav and a right body of typed rows, all driven
 * by one settings record. The component is controlled - the caller owns the
 * open flag, the active category/row/zone, and value changes - so the app's
 * keyboard grammar (and the stories catalog) can drive it without a second
 * key handler inside. The modal sizes itself from the terminal dimensions.
 */

import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { Dialog } from "./primitives/Dialog";
import { CycleRow, TextRow, ToggleRow, type SettingsRowDescriptor } from "./SettingsRows";

export interface SettingsCategory {
  id: string;
  name: string;
  description: string;
  rows: SettingsRowDescriptor[];
}

export type SettingsValues = Record<string, string | boolean>;

export interface SettingsDialogProps {
  isOpen: boolean;
  categories: SettingsCategory[];
  values: SettingsValues;
  activeCategoryId: string;
  activeRowIndex: number;
  activeZone: "nav" | "body";
  onCategorySelect: (categoryId: string) => void;
  onRowActivate: (row: SettingsRowDescriptor) => void;
  theme?: Theme;
}

export function SettingsDialog({
  isOpen,
  categories,
  values,
  activeCategoryId,
  activeRowIndex,
  activeZone,
  onCategorySelect,
  onRowActivate,
  theme,
}: SettingsDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();
  if (!isOpen) return null;
  const category =
    categories.find((candidate) => candidate.id === activeCategoryId) ?? categories[0];
  if (!category) return null;
  return (
    <Dialog
      isOpen
      title=" Settings "
      width={Math.min(76, terminalWidth - 6)}
      height={Math.min(22, terminalHeight - 4)}
      background={tokens.elevated}
      theme={theme}
    >
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <box style={{ flexDirection: "column", width: 18, paddingLeft: 1, paddingRight: 1 }}>
          <text fg={tokens.textDim}>SETTINGS</text>
          {categories.map((candidate) => {
            const isActive = candidate.id === category.id;
            return (
              <box
                key={candidate.id}
                style={{
                  backgroundColor: isActive && activeZone === "nav" ? tokens.border : undefined,
                }}
                onMouseUp={() => onCategorySelect(candidate.id)}
              >
                <text
                  fg={isActive ? tokens.accent : tokens.textMuted}
                >{`${isActive ? "› " : "  "}${candidate.name}`}</text>
              </box>
            );
          })}
        </box>
        <box style={{ width: 1, backgroundColor: tokens.border }} />
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 1 }}>
          <text fg={tokens.text}>{category.name}</text>
          <text fg={tokens.textDim}>{category.description}</text>
          <box style={{ height: 1 }} />
          {category.rows.map((row, rowIndex) => {
            const isActive = activeZone === "body" && rowIndex === activeRowIndex;
            const value = values[row.key];
            if (row.kind === "toggle") {
              return (
                <ToggleRow
                  key={row.key}
                  label={row.label}
                  value={value === true}
                  isActive={isActive}
                  onPress={() => onRowActivate(row)}
                  theme={theme}
                />
              );
            }
            if (row.kind === "cycle") {
              return (
                <CycleRow
                  key={row.key}
                  label={row.label}
                  value={String(value ?? "")}
                  isActive={isActive}
                  onPress={() => onRowActivate(row)}
                  theme={theme}
                />
              );
            }
            return (
              <TextRow
                key={row.key}
                label={row.label}
                value={String(value ?? "")}
                isActive={isActive}
                onPress={() => onRowActivate(row)}
                theme={theme}
              />
            );
          })}
        </box>
      </box>
      <box style={{ flexDirection: "row", height: 1, paddingLeft: 1 }}>
        <text fg={tokens.textDim}>
          {activeZone === "nav"
            ? "j/k category · l/enter into settings · esc close"
            : "j/k row · l/space change · h back · esc close"}
        </text>
      </box>
    </Dialog>
  );
}
