import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { PrototypeSheet } from "./PrototypeSheet";

export const meta: StoryMeta = { title: "PrototypeSheet" };

// Under the story renderer kitty graphics is unavailable, so the sheet shows its
// terminal-capability fallback rather than launching a real headless browser.
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
