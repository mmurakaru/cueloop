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
        leftIcons={[NERD.settings]}
        leftLabel="Subagents"
        title="Read Cueloop Repository"
        tabs={[{ label: "Changes", active: true }]}
        rightIcons={[NERD.expand, NERD.diff, NERD.listTree]}
        onToggleSidebar={() => {}}
        onToggleInspector={() => {}}
      />
    </Frame>
  ),
  expectedColors: [DARK.accent, DARK.textMuted],
  size: { width: 120, height: 3 },
};

export const InspectorCollapsed: Story = {
  render: () => (
    <Frame>
      <ShellHeader
        leftIcons={[NERD.settings]}
        title="Read Cueloop Repository"
        rightIcons={[NERD.search, NERD.expand]}
        onToggleSidebar={() => {}}
        sidebarOpen={false}
        onToggleInspector={() => {}}
        inspectorOpen={false}
      />
    </Frame>
  ),
  expectedColors: [DARK.textMuted],
  size: { width: 120, height: 3 },
};
