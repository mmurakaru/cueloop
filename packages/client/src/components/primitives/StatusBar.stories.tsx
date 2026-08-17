import React from "react";
import { DARK } from "../../theme";
import type { Story, StoryMeta } from "../story";
import { StatusBar } from "./StatusBar";

export const meta: StoryMeta = { title: "primitives/StatusBar" };

export const HintLine: Story = {
  render: () => <StatusBar>j/k move · v span · c comment · q quit</StatusBar>,
  expectedColors: [DARK.textDim],
};
