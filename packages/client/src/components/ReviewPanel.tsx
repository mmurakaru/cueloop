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
import { REVIEW_COMPACT_WIDTH, type ReviewPanelMode } from "../review-panel";

export interface ReviewPanelProps {
  mode: ReviewPanelMode;
  /** Expanded-rail width in columns (already clamped by the app). */
  width: number;
  /** Arm a divider drag; the app tracks the drag itself on the container. */
  onDividerGrab: () => void;
  /** Chevron click: expanded <-> compact (never hidden). */
  onToggle: () => void;
  /** The expanded ReviewRail's props; width and onCollapse are supplied here. */
  rail: Omit<ReviewRailProps, "width" | "onCollapse" | "theme">;
  railRef?: React.Ref<ReviewRailHandle>;
  theme?: Theme;
}

/** An invisible, full-height grab column: the plan's right border is the seam. */
function ReviewDivider({ onGrab }: { onGrab: () => void }): React.ReactNode {
  // childless: it stretches to the row height like the plan and rail beside it,
  // so the three columns share one bottom edge. Invisible, but full-height grab.
  return <box style={{ width: 1 }} onMouseDown={onGrab} />;
}

/** The compact strip: the card count, one kind-colored dot per card, and the
 *  `<` expand chevron, bottom-padded to sit at the same row as the expanded `>`. */
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
      style={{
        width: REVIEW_COMPACT_WIDTH,
        backgroundColor: tokens.panel,
        flexDirection: "column",
        paddingTop: 1,
        paddingBottom: 1,
      }}
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
        <text fg={tokens.textDim}>{"<"}</text>
      </box>
    </box>
  );
}

export function ReviewPanel({
  mode,
  width,
  onDividerGrab,
  onToggle,
  rail,
  railRef,
  theme,
}: ReviewPanelProps): React.ReactNode {
  if (mode === "hidden") return null;
  return (
    <>
      <ReviewDivider onGrab={onDividerGrab} />
      {mode === "expanded" ? (
        <ReviewRail ref={railRef} {...rail} width={width} onCollapse={onToggle} theme={theme} />
      ) : (
        <CompactRail annotations={rail.session.annotations} onExpand={onToggle} theme={theme} />
      )}
    </>
  );
}
