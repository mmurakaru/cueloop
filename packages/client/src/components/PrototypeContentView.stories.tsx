import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { PrototypeContentView } from "./PrototypeContentView";

export const meta: StoryMeta = { title: "Surfaces/PrototypeContentView" };

// The story renderer reports no kitty graphics, so the view shows its fallback.
export const Unsupported: Story = {
  render: () => (
    <PrototypeContentView
      prototypePath="/tmp/example.html"
      canComment={true}
      onCommentElement={() => {}}
    />
  ),
  expectedColors: [DARK.textDim],
  size: { width: 80, height: 24 },
};
