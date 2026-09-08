/**
 * A one-cell vertical scrollbar that mirrors a scrollbox's scroll state, so the bar can sit
 * where the layout wants it (the panel's rightmost column, past the discussion dots) instead
 * of inside the scrollbox's own viewport row. Reads the scroll position each frame, draws the
 * thumb, and a click or drag on the track scrolls the box.
 */

import React, { useRef, type RefObject } from "react";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useFrameMeasure } from "../use-frame-measure";
import { useComponentTheme } from "./theme-context";

interface ScrollState {
  top: number;
  height: number;
  viewport: number;
}

/** The thumb's row and height for a viewport of `track` rows over the scroll state. */
export interface ThumbGeometry {
  row: number;
  height: number;
}

/** Where the thumb sits: proportional to the scroll offset, never shorter than one row, or null when nothing scrolls. */
export function thumbGeometry(state: ScrollState, track: number): ThumbGeometry | null {
  if (track <= 0 || state.height <= state.viewport || state.viewport <= 0) return null;
  const height = Math.max(1, Math.round((state.viewport / state.height) * track));
  const maxTop = state.height - state.viewport;
  const row = Math.round((state.top / maxTop) * (track - height));

  return { row: Math.min(track - height, Math.max(0, row)), height };
}

export interface SurfaceScrollbarProps {
  scrollbox: RefObject<ScrollBoxRenderable | null>;
  theme?: Theme;
}

export function SurfaceScrollbar({ scrollbox, theme }: SurfaceScrollbarProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const trackRef = useRef<BoxRenderable | null>(null);
  const state = useFrameMeasure<ScrollState>(
    () => ({
      top: scrollbox.current?.scrollTop ?? 0,
      height: scrollbox.current?.scrollHeight ?? 0,
      viewport: scrollbox.current?.viewport.height ?? 0,
    }),
    (left, right) =>
      left.top === right.top && left.height === right.height && left.viewport === right.viewport,
    { top: 0, height: 0, viewport: 0 },
  );
  const track = useFrameMeasure(
    () => trackRef.current?.height ?? 0,
    (left, right) => left === right,
    0,
  );
  const thumb = thumbGeometry(state, track);

  // a row on the track maps to the scroll offset that puts the thumb's top there
  const scrollToTrackRow = (screenY: number): void => {
    const box = scrollbox.current;

    if (!box || !thumb) return;
    const row = screenY - (trackRef.current?.y ?? 0) - Math.floor(thumb.height / 2);
    const ratio = Math.min(1, Math.max(0, row / Math.max(1, track - thumb.height)));

    box.scrollTo(Math.round(ratio * (state.height - state.viewport)));
  };

  return (
    <box
      ref={trackRef}
      style={{ width: 1, flexShrink: 0, flexDirection: "column" }}
      onMouseDown={(event) => scrollToTrackRow(event.y)}
      onMouseDrag={(event) => scrollToTrackRow(event.y)}
    >
      {thumb ? (
        <box
          style={{
            position: "absolute",
            top: thumb.row,
            left: 0,
            width: 1,
            height: thumb.height,
            backgroundColor: tokens.textDim,
          }}
        />
      ) : null}
    </box>
  );
}
