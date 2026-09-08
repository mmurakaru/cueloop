import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { WelcomeSurface } from "./WelcomeSurface";

export const meta: StoryMeta = { title: "Surfaces/WelcomeSurface" };

export const Welcome: Story = {
  render: () => <WelcomeSurface version="0.1.0-alpha.66" theme={DARK} />,
  expectedColors: [DARK.accent],
  size: { width: 60, height: 16 },
};
