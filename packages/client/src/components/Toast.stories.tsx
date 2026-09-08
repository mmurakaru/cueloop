import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { Toast } from "./Toast";

export const meta: StoryMeta = { title: "Overlays/Toast" };

export const ShareLink: Story = {
  render: () => <Toast title="share link copied" body="ssh review-4f2a@cueloop.dev" />,
  expectedColors: [DARK.accent],
  size: { width: 60, height: 12 },
};
