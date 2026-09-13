import React, { useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { DARK } from "../theme";
import { OverlayScrollbar } from "./OverlayScrollbar";
import type { Story, StoryMeta } from "./story";

export const meta: StoryMeta = { title: "Chrome/OverlayScrollbar" };

function TallSurface(): React.ReactNode {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);

  return (
    <box style={{ width: 24, height: 8, flexDirection: "row", backgroundColor: DARK.background }}>
      <scrollbox
        ref={scrollRef}
        style={{ flexGrow: 1 }}
        focused={false}
        verticalScrollbarOptions={{ visible: false }}
      >
        {Array.from({ length: 24 }, (_unused, index) => (
          <text key={index} fg={DARK.textMuted}>{`row ${index + 1}`}</text>
        ))}
      </scrollbox>
      <OverlayScrollbar scrollbox={scrollRef} />
    </box>
  );
}

// At rest the overlay bar is hidden; the thumb only appears while the surface is scrolling.
export const AtRest: Story = {
  render: () => <TallSurface />,
  size: { width: 24, height: 8 },
};
