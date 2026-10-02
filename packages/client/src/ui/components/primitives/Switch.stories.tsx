import React from "react";
import { DARK } from "../../../appearance/theme";
import type { Story, StoryMeta } from "../../../stories/story";
import { Switch } from "./Switch";

export const meta: StoryMeta = { title: "Primitives/Switch" };

export const On: Story = {
  render: () => <Switch on onToggle={() => {}} theme={DARK} />,
  expectedColors: [DARK.accent],
  size: { width: 8, height: 1 },
};

export const Off: Story = {
  render: () => <Switch on={false} onToggle={() => {}} theme={DARK} />,
  size: { width: 8, height: 1 },
};
