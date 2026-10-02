import React from "react";
import { DARK } from "../../../appearance/theme";
import type { Story, StoryMeta } from "../../../stories/story";
import { StatusBar } from "./StatusBar";

export const meta: StoryMeta = { title: "Primitives/StatusBar" };

export const HintLine: Story = {
  render: () => <StatusBar>j/k move · v span · c comment · q quit</StatusBar>,
  expectedColors: [DARK.textDim],
};
