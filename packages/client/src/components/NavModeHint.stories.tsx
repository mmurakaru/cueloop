import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { NavModeHint } from "./NavModeHint";

export const meta: StoryMeta = { title: "Chrome/NavModeHint" };

function Frame({ children }: { children: React.ReactNode }): React.ReactNode {
  return <box style={{ width: "100%", backgroundColor: DARK.panel }}>{children}</box>;
}

export const ThreadNav: Story = {
  render: () => (
    <Frame>
      <NavModeHint navMode surface="thread" theme={DARK} />
    </Frame>
  ),
  expectedColors: [DARK.textDim],
  size: { width: 80, height: 1 },
};

export const DiffNav: Story = {
  render: () => (
    <Frame>
      <NavModeHint navMode surface="diff" theme={DARK} />
    </Frame>
  ),
  expectedColors: [DARK.textDim],
  size: { width: 80, height: 1 },
};

export const Composing: Story = {
  render: () => (
    <Frame>
      <NavModeHint navMode={false} surface="thread" theme={DARK} />
    </Frame>
  ),
  expectedColors: [DARK.textDim],
  size: { width: 80, height: 1 },
};
