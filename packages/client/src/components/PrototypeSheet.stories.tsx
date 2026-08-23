import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { PrototypeSheet } from "./PrototypeSheet";

export const meta: StoryMeta = { title: "PrototypeSheet" };

// The story renderer reports no kitty graphics, so the sheet shows its fallback.
export const Unsupported: Story = {
  render: () => (
    <PrototypeSheet
      prototypePath="/tmp/example.html"
      quickActions={[]}
      canComment={true}
      onCommentElement={() => {}}
    />
  ),
  expectedColors: [DARK.textDim],
  size: { width: 80, height: 24 },
};
