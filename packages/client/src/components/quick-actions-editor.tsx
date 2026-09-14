/**
 * The Settings "Actions" body: the quick-action vocabulary editor. Each row is a
 * clickable prompt; the selected-and-expanded row reveals a focused input for the
 * per-action system prompt (the extra guidance appended when the action is used).
 * A reset-to-defaults control and an add-action row bracket the list. Controlled:
 * the app owns the actions, the selection, and which row is expanded.
 */

import React, { useEffect, useRef, useState } from "react";
import type { KeyBinding, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import type { QuickAction } from "../config";
import type { Theme } from "../theme";
import { ScrollArea } from "./ScrollArea";
import { useComponentTheme } from "./theme-context";

// ⏎ never inserts a newline: a system prompt is one line, esc closes the editor.
const ACTION_INPUT_KEY_BINDINGS: KeyBinding[] = [{ name: "return", action: "submit" }];

export interface QuickActionsEditorProps {
  actions: QuickAction[];
  /** The highlighted row; equals the settings body row index. */
  selectedIndex: number;
  /** The row whose system-prompt input is open and focused, or null. */
  expandedIndex: number | null;
  /** Select and toggle a row's editor open/closed. */
  onToggleExpand: (index: number) => void;
  onEditPrompt: (index: number, prompt: string) => void;
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
  onEditPrompt,
  onEditMetadata,
  onReset,
  onAdd,
  theme,
}: QuickActionsEditorProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollChildIntoView(`action-row-${selectedIndex}`);
  }, [selectedIndex]);

  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <box style={{ flexDirection: "row" }}>
        <box style={{ flexGrow: 1 }} />
        <box onMouseUp={onReset}>
          <text fg={tokens.textDim}>reset to defaults ▸</text>
        </box>
      </box>
      <box style={{ height: 1 }} />
      <ScrollArea scrollRef={scrollRef}>
        {actions.map((action, index) => (
          <ActionRow
            key={index}
            rowId={`action-row-${index}`}
            action={action}
            isSelected={index === selectedIndex}
            isExpanded={index === expandedIndex}
            onToggleExpand={() => onToggleExpand(index)}
            onEditPrompt={(prompt) => onEditPrompt(index, prompt)}
            onEditMetadata={(metadata) => onEditMetadata(index, metadata)}
            theme={theme}
          />
        ))}
        <box
          id={`action-row-${actions.length}`}
          style={{ backgroundColor: selectedIndex === actions.length ? tokens.border : undefined }}
          onMouseUp={onAdd}
        >
          <text fg={tokens.textMuted}>+ Add action</text>
        </box>
      </ScrollArea>
    </box>
  );
}

function ActionRow({
  rowId,
  action,
  isSelected,
  isExpanded,
  onToggleExpand,
  onEditPrompt,
  onEditMetadata,
  theme,
}: {
  rowId: string;
  action: QuickAction;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onEditPrompt: (prompt: string) => void;
  onEditMetadata: (metadata: string) => void;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);

  if (isExpanded) {
    return (
      <box id={rowId} style={{ flexDirection: "column" }}>
        <ActionEditor
          action={action}
          isSelected={isSelected}
          onEditPrompt={onEditPrompt}
          onEditMetadata={onEditMetadata}
          onDone={onToggleExpand}
          tokens={tokens}
        />
      </box>
    );
  }

  return (
    <box id={rowId} style={{ flexDirection: "column" }}>
      <box
        style={{ backgroundColor: isSelected ? tokens.border : undefined }}
        onMouseUp={onToggleExpand}
      >
        <text fg={isSelected ? tokens.text : tokens.textMuted}>{`▸ ${action.prompt}`}</text>
      </box>
      {action.metadata ? (
        <box style={{ paddingLeft: 2 }}>
          <text fg={tokens.textDim}>{truncateMetadata(action.metadata)}</text>
        </box>
      ) : null}
    </box>
  );
}

/**
 * The two-field editor for an expanded row: the action title over its system
 * prompt. Mounts fresh per expand, so focus starts on the title without a reset
 * effect; ⏎ steps title -> description -> close, and a click focuses either.
 */
function ActionEditor({
  action,
  isSelected,
  onEditPrompt,
  onEditMetadata,
  onDone,
  tokens,
}: {
  action: QuickAction;
  isSelected: boolean;
  onEditPrompt: (prompt: string) => void;
  onEditMetadata: (metadata: string) => void;
  onDone: () => void;
  tokens: Theme;
}): React.ReactNode {
  const promptRef = useRef<TextareaRenderable | null>(null);
  const metadataRef = useRef<TextareaRenderable | null>(null);
  const [activeField, setActiveField] = useState<"prompt" | "metadata">("prompt");

  // the focused field types from its end, not from the caret parked at the start
  useEffect(() => {
    const editor = activeField === "prompt" ? promptRef.current : metadataRef.current;

    if (editor) editor.cursorOffset = editor.plainText.length;
  }, [activeField]);

  const fieldStyle = {
    height: 1,
    flexGrow: 1,
    backgroundColor: tokens.elevated,
    focusedBackgroundColor: tokens.elevated,
    textColor: tokens.text,
    focusedTextColor: tokens.text,
  } as const;

  return (
    <>
      <box
        style={{ flexDirection: "row", backgroundColor: isSelected ? tokens.border : undefined }}
      >
        <box style={{ width: 2, flexShrink: 0 }}>
          <text fg={isSelected ? tokens.text : tokens.textMuted}>{"▾ "}</text>
        </box>
        <textarea
          ref={promptRef}
          focused={activeField === "prompt"}
          initialValue={action.prompt}
          placeholder="action title"
          keyBindings={ACTION_INPUT_KEY_BINDINGS}
          onMouseUp={() => setActiveField("prompt")}
          onSubmit={() => setActiveField("metadata")}
          onContentChange={() => onEditPrompt(promptRef.current?.plainText ?? "")}
          style={fieldStyle}
        />
      </box>
      <box style={{ flexDirection: "row", paddingLeft: 2 }}>
        <box style={{ width: 2, flexShrink: 0 }}>
          <text fg={tokens.textDim}>{">"}</text>
        </box>
        <textarea
          ref={metadataRef}
          focused={activeField === "metadata"}
          initialValue={action.metadata ?? ""}
          placeholder="extra system prompt appended to this comment (optional)"
          keyBindings={ACTION_INPUT_KEY_BINDINGS}
          onMouseUp={() => setActiveField("metadata")}
          onSubmit={onDone}
          onContentChange={() => onEditMetadata(metadataRef.current?.plainText ?? "")}
          style={fieldStyle}
        />
      </box>
    </>
  );
}

/** A one-line preview of the system prompt under a collapsed row. */
function truncateMetadata(metadata: string): string {
  return metadata.length > 44 ? `${metadata.slice(0, 43)}…` : metadata;
}
