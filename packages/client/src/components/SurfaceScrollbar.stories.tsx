import React, { useRef } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { DARK } from "../theme";
import { SurfaceScrollbar } from "./SurfaceScrollbar";
import type { Story, StoryMeta } from "./story";

export const meta: StoryMeta = { title: "Chrome/SurfaceScrollbar" };

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
      <SurfaceScrollbar scrollbox={scrollRef} />
    </box>
  );
}

// The mirrored bar: content three times the viewport puts a thumb a third as tall at the top.
export const ThumbAtTop: Story = {
  render: () => <TallSurface />,
  expectedColors: [DARK.textDim],
  size: { width: 24, height: 8 },
};
