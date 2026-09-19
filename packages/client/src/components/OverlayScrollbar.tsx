/**
 * A one-cell vertical scrollbar that mirrors a scrollbox's scroll state, so the bar can sit
 * where the layout wants it (the panel's rightmost column, past the discussion dots) instead
 * of inside the scrollbox's own viewport row. It is an overlay: the thumb appears while the
 * surface is scrolling and hides once scrolling has been idle, so a resting surface shows none.
 */

import React, { useEffect, useRef, useState, type RefObject } from "react";
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { useFrameMeasure } from "../use-frame-measure";
import { useComponentTheme } from "./theme-context";

const HIDE_DELAY_MS = 1500;

interface ScrollState {
  top: number;
  height: number;
  viewport: number;
}

export interface ThumbGeometry {
  row: number;
  height: number;
}

export function thumbGeometry(state: ScrollState, track: number): ThumbGeometry | null {
  if (track <= 0 || state.height <= state.viewport || state.viewport <= 0) return null;
  const height = Math.max(1, Math.round((state.viewport / state.height) * track));
  const maxTop = state.height - state.viewport;
  const row = Math.round((state.top / maxTop) * (track - height));

  return { row: Math.min(track - height, Math.max(0, row)), height };
}

export interface OverlayScrollbarProps {
  scrollbox: RefObject<ScrollBoxRenderable | null>;
  theme?: Theme;
}

export function OverlayScrollbar({ scrollbox, theme }: OverlayScrollbarProps): React.ReactNode {
  const tokens = useComponentTheme(theme);
  const trackRef = useRef<BoxRenderable | null>(null);
  const [visible, setVisible] = useState(false);
  const draggingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTopRef = useRef<number | null>(null);

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

  const reveal = (): void => {
    setVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!draggingRef.current) setVisible(false);
    }, HIDE_DELAY_MS);
  };

  // reveal on real scroll movement, never on first mount, then hide once idle
  useEffect(() => {
    if (prevTopRef.current !== null && state.top !== prevTopRef.current) reveal();
    prevTopRef.current = state.top;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.top]);

  useEffect(
    () => () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    [],
  );

  const geometry = thumbGeometry(state, track);
  const thumb = visible ? geometry : null;

  const scrollToTrackRow = (screenY: number): void => {
    const box = scrollbox.current;

    if (!box || !geometry) return;
    const row = screenY - (trackRef.current?.y ?? 0) - Math.floor(geometry.height / 2);
    const ratio = Math.min(1, Math.max(0, row / Math.max(1, track - geometry.height)));

    box.scrollTo(Math.round(ratio * (state.height - state.viewport)));
    reveal();
  };

  return (
    <box
      ref={trackRef}
      style={{ width: 1, flexShrink: 0, flexDirection: "column" }}
      onMouseDown={(event) => {
        draggingRef.current = true;
        scrollToTrackRow(event.y);
      }}
      onMouseDrag={(event) => scrollToTrackRow(event.y)}
      onMouseUp={() => {
        draggingRef.current = false;
        reveal();
      }}
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
