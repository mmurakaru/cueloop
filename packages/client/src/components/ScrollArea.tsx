/**
 * A scrollbox whose bar follows the global rule: no always-on scrollbar. The built-in bar is
 * hidden and an OverlayScrollbar rides the rightmost column, appearing only while scrolling.
 * Pass scrollRef to keep scrollTo / scrollChildIntoView on the underlying ScrollBox.
 */

import React, { useRef, type ReactNode, type RefObject } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { Theme } from "../theme";
import { OverlayScrollbar } from "./OverlayScrollbar";

export interface ScrollAreaProps {
  children: ReactNode;
  focused?: boolean;
  theme?: Theme;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
}

export function ScrollArea({
  children,
  focused = false,
  theme,
  scrollRef,
}: ScrollAreaProps): React.ReactNode {
  const innerRef = useRef<ScrollBoxRenderable | null>(null);
  const attach = (node: ScrollBoxRenderable | null): void => {
    innerRef.current = node;
    if (scrollRef) scrollRef.current = node;
  };

  return (
    <box style={{ flexGrow: 1, flexDirection: "row" }}>
      <scrollbox
        ref={attach}
        style={{ flexGrow: 1 }}
        focused={focused}
        verticalScrollbarOptions={{ visible: false }}
      >
        {children}
      </scrollbox>
      <OverlayScrollbar scrollbox={innerRef} theme={theme} />
    </box>
  );
}
