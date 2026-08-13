/**
 * The review surface's outer shell: the grabbable divider plus the rail in one
 * of three modes - expanded (the full ReviewRail, resizable), compact (a narrow
 * count + dots strip that hands width back to the plan), or hidden (nothing at
 * all, no leftover tab). The keybinding cycles all three; the clickable chevron
 * toggles expanded and compact only. App owns the width/mode state and the drag
 * on the container; this file only reads them. The geometry (width clamp, the
 * divider glyph column, the cycle) lives in review-panel.ts so this stays
 * declarative.
 */

import React from "react";
import type { Annotation } from "@cueloop/schema";
import type { Theme } from "../theme";
import { useComponentTheme } from "./theme-context";
import { ReviewRail, type ReviewRailHandle, type ReviewRailProps } from "./ReviewRail";
import { REVIEW_COMPACT_WIDTH, reviewRowsToDivider, type ReviewPanelMode } from "../review-panel";

export interface ReviewPanelProps {
  mode: ReviewPanelMode;
  /** Expanded-rail width in columns (already clamped by the app). */
  width: number;
  /** Rows for the divider glyph column - the height of the plan/rail row. */
  height: number;
  /** Accent the divider while a drag is live. */
  dragging: boolean;
  /** Arm a divider drag; the app tracks the drag itself on the container. */
  onDividerGrab: () => void;
  /** Chevron click: expanded <-> compact (never hidden). */
  onToggle: () => void;
  /** The expanded ReviewRail's props; width and onCollapse are supplied here. */
  rail: Omit<ReviewRailProps, "width" | "onCollapse" | "theme">;
  railRef?: React.Ref<ReviewRailHandle>;
  theme?: Theme;
}

/** A single-column stack of `│`, accent while dragging. Grabbing arms a drag. */
function ReviewDivider({
  dragging,
  rows,
  onGrab,
  theme,
}: {
  dragging: boolean;
  rows: number;
  onGrab: () => void;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);
  return (
    <box style={{ width: 1 }} onMouseDown={onGrab}>
      <text fg={dragging ? tokens.accent : tokens.border}>{reviewRowsToDivider(rows)}</text>
    </box>
  );
}

/** The compact strip: the card count, one kind-colored dot per card, and the
 *  `«` chevron left-bound to match the expanded `»` gap. */
function CompactRail({
  annotations,
  onExpand,
  theme,
}: {
  annotations: Annotation[];
  onExpand: () => void;
  theme?: Theme;
}): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const dotColor = (annotation: Annotation): string =>
    annotation.kind === "suggestion" ? tokens.green : tokens.accent;
  return (
    <box
      style={{ width: REVIEW_COMPACT_WIDTH, backgroundColor: tokens.panel, flexDirection: "column", paddingTop: 1 }}
    >
      <box style={{ alignItems: "center" }}>
        <text fg={tokens.accent}>{String(annotations.length)}</text>
      </box>
      <box style={{ height: 1 }} />
      <box style={{ flexDirection: "column", alignItems: "center" }}>
        {annotations.map((annotation) => (
          <text key={annotation.id} fg={dotColor(annotation)}>
            ●
          </text>
        ))}
      </box>
      <box style={{ flexGrow: 1 }} />
      <box style={{ paddingLeft: 1 }} onMouseUp={onExpand}>
        <text fg={tokens.textDim}>«</text>
      </box>
    </box>
  );
}

export function ReviewPanel({
  mode,
  width,
  height,
  dragging,
  onDividerGrab,
  onToggle,
  rail,
  railRef,
  theme,
}: ReviewPanelProps): React.ReactNode {
  if (mode === "hidden") return null;
  return (
    <>
      <ReviewDivider dragging={dragging} rows={height} onGrab={onDividerGrab} theme={theme} />
      {mode === "expanded" ? (
        <ReviewRail ref={railRef} {...rail} width={width} onCollapse={onToggle} theme={theme} />
      ) : (
        <CompactRail annotations={rail.session.annotations} onExpand={onToggle} theme={theme} />
      )}
    </>
  );
}
