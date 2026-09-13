import React from "react";
import { DARK } from "../theme";
import { ScrollArea } from "./ScrollArea";
import type { Story, StoryMeta } from "./story";

export const meta: StoryMeta = { title: "Chrome/ScrollArea" };

// Taller-than-viewport content; the overlay bar stays hidden until the surface scrolls.
export const AtRest: Story = {
  render: () => (
    <box style={{ width: 24, height: 8, backgroundColor: DARK.background }}>
      <ScrollArea>
        {Array.from({ length: 24 }, (_unused, index) => (
          <text key={index} fg={DARK.textMuted}>{`row ${index + 1}`}</text>
        ))}
      </ScrollArea>
    </box>
  ),
  size: { width: 24, height: 8 },
};
