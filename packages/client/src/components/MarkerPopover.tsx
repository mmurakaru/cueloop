/**
 * The marker-actions popover: the visible form of plan span mode, floated as a
 * bordered card above the marked block. The toolbar card is always shown -
 * `comment · cut · actions · [x]`, each label keyboard-shortcut-backed and
 * clickable. Pressing `actions` drops a second card below it listing the
 * quick-actions; picking one inserts its preset comment. Plan-only: the diff
 * review has no span.
 */

import React from "react";
import type { MouseEvent } from "@opentui/core";
import type { Theme } from "../theme";
import type { QuickAction } from "../config";
import { useComponentTheme } from "./theme-context";
import { cardHeight } from "./primitives/Card";
import { FRAME_BORDER_STYLE } from "./primitives/frame";

export interface MarkerPopoverProps {
  /** "toolbar" is the bar alone; "actions" also drops the quick-actions card. */
  view: "toolbar" | "actions";
  actions: QuickAction[];
  /** Highlighted action in the dropdown (accent); ignored in toolbar view. */
  actionIndex: number;
  /** Show the cut affordance: owner-only, like every other plan-edit control. */
  canCut: boolean;
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
  canCut,
  onComment,
  onCut,
  onOpenActions,
  onClose,
  onPickAction,
  onBack,
  theme,
}: MarkerPopoverProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const cardStyle = {
    border: true,
    borderStyle: FRAME_BORDER_STYLE,
    borderColor: tokens.border,
    backgroundColor: tokens.elevated,
    flexDirection: "column" as const,
    paddingLeft: 1,
    paddingRight: 1,
  };
  const open = view === "actions";
  return (
    <box
      style={{ flexDirection: "column", alignItems: "flex-start" }}
      // a release on the popover is the popover's own click; it must never
      // bubble to the sheet's selection-release fallback and re-enter span mode
      onMouseUp={(event: MouseEvent) => event.stopPropagation()}
    >
      <box style={{ ...cardStyle, height: cardHeight(1) }}>
        <box style={{ flexDirection: "row" }}>
          <text fg={tokens.accent} onMouseUp={onComment}>
            comment
          </text>
          <text fg={tokens.textDim}> · </text>
          {canCut ? (
            <>
              <text fg={tokens.red} onMouseUp={onCut}>
                cut
              </text>
              <text fg={tokens.textDim}> · </text>
            </>
          ) : null}
          <text fg={open ? tokens.accent : tokens.textMuted} onMouseUp={onOpenActions}>
            actions
          </text>
          <text fg={tokens.textDim}> · </text>
          <text fg={tokens.textDim} onMouseUp={onClose}>
            [x]
          </text>
        </box>
      </box>
      {open ? (
        <box style={{ ...cardStyle, height: cardHeight(actions.length + 1) }}>
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
            {"  "}‹ back
          </text>
        </box>
      ) : null}
    </box>
  );
}
