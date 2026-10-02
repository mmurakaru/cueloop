import React from "react";
import { DARK } from "../../appearance/theme";
import type { Story, StoryMeta } from "../../stories/story";
import { WelcomePlayground } from "./WelcomePlayground";

export const meta: StoryMeta = { title: "Surfaces/WelcomePlayground" };

export const Welcome: Story = {
  render: () => <WelcomePlayground quickActions={[]} theme={DARK} />,
  expectedColors: [DARK.textDim],
  size: { width: 72, height: 20 },
};
