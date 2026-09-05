import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ThreadFooter } from "./ThreadFooter";

export const meta: StoryMeta = { title: "Chrome/ThreadFooter" };

function Frame({ children }: { children: React.ReactNode }): React.ReactNode {
  return <box style={{ width: "100%", backgroundColor: DARK.panel }}>{children}</box>;
}

export const Default: Story = {
  render: () => (
    <Frame>
      <ThreadFooter repo="cueloop" branch="main" onSubmit={() => {}} />
    </Frame>
  ),
  expectedColors: [DARK.accent, DARK.textMuted],
  size: { width: 80, height: 1 },
};

export const ReadOnly: Story = {
  render: () => (
    <Frame>
      <ThreadFooter repo="cueloop" branch="design/tui" canSubmit={false} onSubmit={() => {}} />
    </Frame>
  ),
  expectedColors: [DARK.textDim],
  size: { width: 80, height: 1 },
};
