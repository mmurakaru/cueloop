/**
 * The marker-actions popover: the visible form of plan span mode, rendered
 * inline at the marked block. In "toolbar" mode it is one row -
 * `comment · cut · actions · [x]` - each label keyboard-shortcut-backed and
 * clickable. In "actions" mode it is the quick-actions list, one row
 * highlighted; picking a row inserts its preset comment. Plan-only: the diff
 * review has no span.
 */

import React from "react";
import type { Theme } from "../theme";
import type { QuickAction } from "../config";
import { useComponentTheme } from "./theme-context";

export interface MarkerPopoverProps {
  /** "toolbar" is the span row; "actions" is the quick-actions list. */
  view: "toolbar" | "actions";
  actions: QuickAction[];
  /** Highlighted action in the list (accent); ignored in toolbar view. */
  actionIndex: number;
  onComment: () => void;
  onCut: () => void;
  onOpenActions: () => void;
  onClose: () => void;
  onPickAction: (index: number) => void;
  onBack: () => void;
  theme?: Theme;
}

export function MarkerPopover({
  view,
  actions,
  actionIndex,
  onComment,
  onCut,
  onOpenActions,
  onClose,
  onPickAction,
  onBack,
  theme,
}: MarkerPopoverProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  if (view === "toolbar") {
    return (
      <box style={{ flexDirection: "row", marginLeft: 2 }}>
        <text fg={tokens.accent} onMouseUp={onComment}>
          comment
        </text>
        <text fg={tokens.textDim}> · </text>
        <text fg={tokens.red} onMouseUp={onCut}>
          cut
        </text>
        <text fg={tokens.textDim}> · </text>
        <text fg={tokens.textMuted} onMouseUp={onOpenActions}>
          actions
        </text>
        <text fg={tokens.textDim}> · </text>
        <text fg={tokens.textDim} onMouseUp={onClose}>
          [x]
        </text>
      </box>
    );
  }
  return (
    <box style={{ flexDirection: "column", marginLeft: 2 }}>
      {actions.map((action, index) => (
        <text
          key={index}
          fg={index === actionIndex ? tokens.accent : tokens.textMuted}
          onMouseUp={() => onPickAction(index)}
        >
          {index === actionIndex ? "› " : "  "}
          {action.prompt}
        </text>
      ))}
      <text fg={tokens.textDim} onMouseUp={onBack}>
        {"  "}[x] back
      </text>
    </box>
  );
}
