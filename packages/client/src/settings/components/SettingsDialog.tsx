/**
 * The settings overlay: a centered Dialog whose left nav lists the categories as
 * first-level leaves (General, Appearance, Actions, Keybinds), and whose right
 * body shows the active category's typed rows or the keybinds cheatsheet. The
 * component is controlled: the caller owns the open flag, the active
 * category/row/zone, and value changes, so the app's keyboard grammar (and the
 * stories catalog) drive it without a second key handler inside.
 */

import { ScrollArea } from "../../ui/components/ScrollArea";
import React from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { Theme } from "../../appearance/theme";
import type { CheatsheetSection } from "../../keyboard/key-bindings";
import { useComponentTheme } from "../../appearance/components/theme-context";
import { Dialog } from "../../ui/components/primitives/Dialog";
import { Tree } from "../../ui/components/primitives/Tree";
import type { TreeNode } from "../../ui/components/primitives/tree-model";
import { CycleRow, TextRow, ToggleRow, type SettingsRowDescriptor } from "./SettingsRows";

export interface SettingsCategory {
  id: string;
  name: string;
  rows: SettingsRowDescriptor[];
  customBody?: React.ReactNode;
}

export type SettingsValues = Record<string, string | boolean>;

/** The category id whose right pane shows the keybinds cheatsheet rather than rows. */
const KEYBINDS_CATEGORY_ID = "keybinds";

export interface SettingsDialogProps {
  isOpen: boolean;
  version: string;
  categories: SettingsCategory[];
  values: SettingsValues;
  keybindsSections: CheatsheetSection[];
  activeCategoryId: string;
  activeRowIndex: number;
  activeZone: "nav" | "body";
  onCategorySelect: (categoryId: string) => void;
  onRowActivate: (row: SettingsRowDescriptor) => void;
  onClose: () => void;
  theme?: Theme;
}

function navTree(categories: SettingsCategory[]): TreeNode[] {
  return categories.map((category) => ({ id: category.id, label: category.name }));
}

function KeybindsBody({
  sections,
  tokens,
}: {
  sections: CheatsheetSection[];
  tokens: Theme;
}): React.ReactNode {
  return (
    <ScrollArea>
      {sections.map((section) => (
        <box key={section.title} style={{ flexDirection: "column" }}>
          <text fg={tokens.accent}>{section.title}</text>
          {section.entries.map((entry, index) => (
            <text key={`${section.title}-${index}`}>
              <span fg={tokens.text}>{entry.keys.padEnd(12)}</span>
              <span fg={tokens.textMuted}>{entry.label}</span>
            </text>
          ))}
          <text> </text>
        </box>
      ))}
    </ScrollArea>
  );
}

export function SettingsDialog({
  isOpen,
  version,
  categories,
  values,
  keybindsSections,
  activeCategoryId,
  activeRowIndex,
  activeZone,
  onCategorySelect,
  onRowActivate,
  onClose,
  theme,
}: SettingsDialogProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();

  if (!isOpen) return null;

  const category =
    categories.find((candidate) => candidate.id === activeCategoryId) ?? categories[0];

  if (!category) return null;

  const onKeybinds = category.id === KEYBINDS_CATEGORY_ID;

  return (
    <Dialog
      isOpen
      title=" Settings "
      width={Math.min(76, terminalWidth - 6)}
      height={Math.min(22, terminalHeight - 4)}
      background={tokens.elevated}
      onDismiss={onClose}
      theme={theme}
    >
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <box style={{ flexDirection: "column", width: 20, paddingLeft: 1, paddingRight: 1 }}>
          <Tree
            nodes={navTree(categories)}
            expandedIds={new Set<string>()}
            selectedId={category.id}
            hideIcons
            selectedBackground={tokens.border}
            onSelect={onCategorySelect}
            onToggle={onCategorySelect}
            theme={theme}
          />
        </box>
        <box style={{ borderStyle: "single", border: ["left"], borderColor: tokens.border }} />
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 1 }}>
          {onKeybinds ? <KeybindsBody sections={keybindsSections} tokens={tokens} /> : null}
          {onKeybinds ? null : category.customBody}
          {onKeybinds
            ? null
            : category.rows.map((row, rowIndex) => {
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
      <box style={{ flexDirection: "row", height: 1, paddingLeft: 1, paddingRight: 1 }}>
        <text fg={tokens.textDim}>
          {activeZone === "nav"
            ? "j/k nav · l/tab open · esc close"
            : "j/k row · l/space change · h back · esc close"}
        </text>
        <box style={{ flexGrow: 1 }} />
        <text fg={tokens.textDim}>{`cueloop v${version}`}</text>
      </box>
    </Dialog>
  );
}
