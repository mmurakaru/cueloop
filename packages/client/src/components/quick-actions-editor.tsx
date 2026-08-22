/**
 * The Settings "Actions" body: the quick-action vocabulary editor. Each row is a
 * clickable prompt; the selected-and-expanded row reveals a focused input for the
 * per-action system prompt (the extra guidance appended when the action is used).
 * A reset-to-defaults control and an add-action row bracket the list. Controlled:
 * the app owns the actions, the selection, and which row is expanded.
 */

import React, { useRef } from "react";
import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import type { QuickAction } from "../config";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";

// ⏎ never inserts a newline: a system prompt is one line, esc closes the editor.
const ACTION_INPUT_KEY_BINDINGS: KeyBinding[] = [{ name: "return", action: "submit" }];

export interface QuickActionsEditorProps {
  actions: QuickAction[];
  /** The highlighted row; equals the settings body row index. */
  selectedIndex: number;
  /** The row whose system-prompt input is open and focused, or null. */
  expandedIndex: number | null;
  /** Select and toggle a row's system-prompt input open/closed. */
  onToggleExpand: (index: number) => void;
  onEditMetadata: (index: number, metadata: string) => void;
  onReset: () => void;
  onAdd: () => void;
  theme?: Theme;
}

export function QuickActionsEditor({
  actions,
  selectedIndex,
  expandedIndex,
  onToggleExpand,
  onEditMetadata,
  onReset,
  onAdd,
  theme,
}: QuickActionsEditorProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "row" }}>
        <box style={{ flexGrow: 1 }}>
          <text fg={tokens.textDim}>click a prompt to edit its system prompt</text>
        </box>
        <box onMouseUp={onReset}>
          <text fg={tokens.textDim}>reset to defaults ▸</text>
        </box>
      </box>
      <box style={{ height: 1 }} />
      {actions.map((action, index) => (
        <ActionRow
          key={index}
          action={action}
          isSelected={index === selectedIndex}
          isExpanded={index === expandedIndex}
          onToggleExpand={() => onToggleExpand(index)}
          onEditMetadata={(metadata) => onEditMetadata(index, metadata)}
          theme={theme}
        />
      ))}
      <box
        style={{ backgroundColor: selectedIndex === actions.length ? tokens.border : undefined }}
        onMouseUp={onAdd}
      >
        <text fg={tokens.textMuted}>+ Add action</text>
      </box>
    </box>
  );
}

function ActionRow({
  action,
  isSelected,
  isExpanded,
  onToggleExpand,
  onEditMetadata,
  theme,
}: {
  action: QuickAction;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEditMetadata: (metadata: string) => void;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const inputRef = useRef<TextareaRenderable | null>(null);
  return (
    <box style={{ flexDirection: "column" }}>
      <box
        style={{ backgroundColor: isSelected ? tokens.border : undefined }}
        onMouseUp={onToggleExpand}
      >
        <text fg={isSelected ? tokens.text : tokens.textMuted}>
          {`${isExpanded ? "▾ " : "▸ "}${action.prompt}`}
        </text>
      </box>
      {isExpanded ? (
        <box style={{ flexDirection: "row", paddingLeft: 2 }}>
          <box style={{ width: 2, flexShrink: 0 }}>
            <text fg={tokens.textDim}>{">"}</text>
          </box>
          <textarea
            ref={inputRef}
            focused
            initialValue={action.metadata ?? ""}
            placeholder="extra system prompt appended to this comment (optional)"
            keyBindings={ACTION_INPUT_KEY_BINDINGS}
            onContentChange={() => onEditMetadata(inputRef.current?.plainText ?? "")}
            style={{
              height: 1,
              flexGrow: 1,
              backgroundColor: tokens.elevated,
              focusedBackgroundColor: tokens.elevated,
              textColor: tokens.text,
              focusedTextColor: tokens.text,
            }}
          />
        </box>
      ) : action.metadata ? (
        <box style={{ paddingLeft: 2 }}>
          <text fg={tokens.textDim}>{truncateMetadata(action.metadata)}</text>
        </box>
      ) : null}
    </box>
  );
}

/** A one-line preview of the system prompt under a collapsed row. */
function truncateMetadata(metadata: string): string {
  return metadata.length > 44 ? `${metadata.slice(0, 43)}…` : metadata;
}
