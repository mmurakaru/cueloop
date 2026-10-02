/**
 * A scrollbox whose bar follows the global rule: no always-on scrollbar. The built-in bar is
 * hidden and an OverlayScrollbar rides the rightmost column, appearing only while scrolling.
 * Pass scrollRef to keep scrollTo / scrollChildIntoView on the underlying ScrollBox.
 */

import React, { useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { MacOSScrollAccel, type ScrollBoxRenderable } from "@opentui/core";
import type { Theme } from "../../appearance/theme";
import { OverlayScrollbar } from "./OverlayScrollbar";

export interface ScrollAreaProps {
  children: ReactNode;
  focused?: boolean;
  theme?: Theme;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
  id?: string;
  /** Reveal this mounted row when keyboard selection changes. */
  revealId?: string;
  /** Use gesture acceleration for a scrollable file tree. */
  gestureWheel?: boolean;
}

export function ScrollArea({
  children,
  focused = false,
  theme,
  scrollRef,
  id,
  revealId,
  gestureWheel = false,
}: ScrollAreaProps): React.ReactNode {
  const innerRef = useRef<ScrollBoxRenderable | null>(null);
  const wheelAcceleration = useMemo(
    () => (gestureWheel ? new MacOSScrollAccel({ A: 0.4, tau: 4, maxMultiplier: 3 }) : undefined),
    [gestureWheel],
  );
  const attach = (node: ScrollBoxRenderable | null): void => {
    innerRef.current = node;
    if (scrollRef) scrollRef.current = node;
  };

  useLayoutEffect(() => {
    if (revealId === undefined) return;
    innerRef.current?.scrollChildIntoView(`tree-row-${revealId}`);
  }, [revealId]);

  return (
    <box style={{ flexGrow: 1, flexDirection: "row" }}>
      <scrollbox
        id={id}
        ref={attach}
        style={{ flexGrow: 1 }}
        focused={focused}
        scrollAcceleration={wheelAcceleration}
        verticalScrollbarOptions={{ visible: false }}
      >
        {children}
      </scrollbox>
      <OverlayScrollbar scrollbox={innerRef} theme={theme} />
    </box>
  );
}
