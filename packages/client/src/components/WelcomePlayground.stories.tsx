import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { WelcomePlayground } from "./WelcomePlayground";

export const meta: StoryMeta = { title: "Surfaces/WelcomePlayground" };

export const Welcome: Story = {
  render: () => <WelcomePlayground version="0.1.0-alpha.66" quickActions={[]} theme={DARK} />,
  expectedColors: [DARK.textDim],
  size: { width: 72, height: 20 },
};
