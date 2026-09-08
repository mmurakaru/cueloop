import React from "react";
import { DARK } from "../../theme";
import type { Story, StoryMeta } from "../story";
import { Card } from "./Card";

export const meta: StoryMeta = { title: "Primitives/Card" };

export const Titled: Story = {
  render: () => (
    <Card title=" a titled card " contentRows={2}>
      <text>first content row</text>
      <text>second content row</text>
    </Card>
  ),
  expectedColors: [DARK.border, DARK.elevated],
};

export const AccentBorder: Story = {
  render: () => (
    <Card title=" accented " contentRows={1} borderColor={DARK.accent}>
      <text>content</text>
    </Card>
  ),
  expectedColors: [DARK.accent],
};
