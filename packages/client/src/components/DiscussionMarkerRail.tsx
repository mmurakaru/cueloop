/**
 * The right-edge discussion navigator: a vertically-centered column of dots, one
 * per discussion, that highlights on hover, shows a floating preview, and jumps
 * on click. The plan thread view and each diff editor group render one on their
 * right edge, so comment navigation reads the same on prose and on code. The
 * preview draws at the app root (OpenTUI has no z-index) so no pane border slices it.
 */

import React, { useEffect, useRef, useState, type RefObject } from "react";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import type { TextSpan } from "../thread-selection";
import type { Discussion } from "../discussions";
import { useFrameMeasure } from "../use-frame-measure";
import { useComponentTheme } from "./theme-context";
import { useRootOverlay } from "./RootOverlay";
import { SurfaceScrollbar } from "./SurfaceScrollbar";

interface HoveredMarker {
  key: string;
  screenY: number;
  anchorX: number;
}

function ScrollMarkers({
  discussions,
  hovered,
  tokens,
  onHover,
  onJump,
}: {
  discussions: Discussion[];
  hovered: string | null;
  tokens: Theme;
  onHover: (marker: HoveredMarker | null) => void;
  onJump: (key: string) => void;
}): React.ReactNode {
  const railRef = useRef<BoxRenderable | null>(null);
  const height = useFrameMeasure(
    () => railRef.current?.height ?? 0,
    (left, right) => left === right,
    0,
  );

  const firstRow = Math.max(0, Math.floor((height - discussions.length) / 2));
  const rowFor = (index: number): number => firstRow + index;
  const indexAt = (row: number): number | null => {
    const index = row - firstRow;

    return index >= 0 && index < discussions.length ? index : null;
  };
  const hoveredIndex = discussions.findIndex((discussion) => discussion.key === hovered);
  const colorFor = (index: number): string => {
    if (index === hoveredIndex) return tokens.text;
    if (hoveredIndex >= 0 && discussions.length >= 5 && Math.abs(index - hoveredIndex) === 1) {
      return tokens.textMuted;
    }

    return tokens.textDim;
  };

  return (
    <box
      ref={railRef}
      style={{ width: 3, flexShrink: 0, flexDirection: "column" }}
      onMouseMove={(event) => {
        const railY = railRef.current?.y ?? 0;
        const index = indexAt(event.y - railY);

        onHover(
          index === null
            ? null
            : {
                key: discussions[index]!.key,
                // screen coordinates so the preview can render at the app root, above every pane rule
                screenY: railY + rowFor(index),
                anchorX: railRef.current?.x ?? 0,
              },
        );
      }}
      onMouseOut={() => onHover(null)}
      onMouseDown={(event) => {
        const index = indexAt(event.y - (railRef.current?.y ?? 0));

        if (index !== null) onJump(discussions[index]!.key);
      }}
    >
      {discussions.map((discussion, index) => (
        <text
          key={discussion.key}
          selectable={false}
          style={{ position: "absolute", top: rowFor(index), left: 0 }}
          fg={colorFor(index)}
        >
          {(index === hoveredIndex ? "●" : "○").padStart(2)}
        </text>
      ))}
    </box>
  );
}

export interface DiscussionMarkerRailProps {
  discussions: Discussion[];
  /** The text a discussion's span covers, for the hover preview. */
  spanQuote: (span: TextSpan) => string;
  onJump: (key: string) => void;
  /** The surface's scrollbox; when given, its scrollbar draws past the dots as the panel's rightmost column. */
  scrollbox?: RefObject<ScrollBoxRenderable | null>;
  theme?: Theme;
}

export function DiscussionMarkerRail({
  discussions,
  spanQuote,
  onJump,
  scrollbox,
  theme,
}: DiscussionMarkerRailProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const [hovered, setHovered] = useState<HoveredMarker | null>(null);
  const { setOverlay, clearOverlay } = useRootOverlay();

  const preview = (): React.ReactNode => {
    if (hovered === null) return null;
    const discussion = discussions.find((candidate) => candidate.key === hovered.key);

    if (!discussion) return null;
    const quote = spanQuote(discussion.span);
    const lastComment = discussion.annotations.at(-1)!;

    return (
      <box
        style={{
          position: "absolute",
          top: Math.max(0, hovered.screenY - 1),
          left: Math.max(0, hovered.anchorX - 48),
          width: 48,
          flexDirection: "column",
          border: true,
          borderStyle: "single",
          borderColor: tokens.border,
          backgroundColor: tokens.elevated,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text fg={tokens.textDim}>{`"${quote.slice(0, 42)}"`}</text>
        <text fg={tokens.text}>
          {`${lastComment.author === undefined ? "●" : "○"} ${lastComment.body}`.slice(0, 44)}
        </text>
        <text fg={tokens.textDim}>
          {`${discussion.annotations.length} comment${
            discussion.annotations.length === 1 ? "" : "s"
          } · click to jump`}
        </text>
      </box>
    );
  };

  // render the preview at the app root (above every pane rule); OpenTUI has no z-index, so an
  // absolute box inside this pane would be sliced by the next pane's border
  useEffect(() => {
    setOverlay(preview());

    return () => clearOverlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hovered, discussions, tokens]);

  return (
    <>
      <ScrollMarkers
        discussions={discussions}
        hovered={hovered?.key ?? null}
        tokens={tokens}
        onHover={setHovered}
        onJump={onJump}
      />
      {scrollbox ? <SurfaceScrollbar scrollbox={scrollbox} theme={theme} /> : null}
    </>
  );
}
