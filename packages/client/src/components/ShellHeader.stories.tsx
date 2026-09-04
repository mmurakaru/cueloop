import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ShellHeader } from "./ShellHeader";
import { NERD } from "./primitives/icons";

export const meta: StoryMeta = { title: "Layout/ShellHeader" };

function Frame({ children }: { children: React.ReactNode }): React.ReactNode {
  return <box style={{ width: "100%", backgroundColor: DARK.panel }}>{children}</box>;
}

export const ReviewSurface: Story = {
  render: () => (
    <Frame>
      <ShellHeader
        leftIcons={[NERD.settings, NERD.sidebar]}
        leftLabel="Subagents"
        title="Read Cueloop Repository"
        tabs={[{ label: "Changes", active: true }]}
        rightIcons={[NERD.search, NERD.expand, NERD.split, NERD.sidebar]}
      />
    </Frame>
  ),
  expectedColors: [DARK.accent, DARK.textMuted],
  size: { width: 120, height: 3 },
};

export const StoriesCatalog: Story = {
  render: () => (
    <Frame>
      <ShellHeader
        leftIcons={[NERD.settings, NERD.sidebar]}
        leftLabel="cueloop stories"
        title="Cards/AnnotationCard / SavedSelected"
        rightIcons={[NERD.search, NERD.expand, NERD.sidebar]}
      />
    </Frame>
  ),
  expectedColors: [DARK.textMuted],
  size: { width: 120, height: 3 },
};
