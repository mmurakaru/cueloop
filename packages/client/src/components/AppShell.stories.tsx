import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { AppShell } from "./AppShell";

export const meta: StoryMeta = { title: "Layout/AppShell" };

function Threads(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.textDim}>Pinned</text>
      <text fg={DARK.accent}> Read Cueloop Repository</text>
      <text> </text>
      <text fg={DARK.textDim}>Threads</text>
      <text fg={DARK.textMuted}> A standalone thought</text>
    </box>
  );
}

function Thread(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.text}>the conversation renders here</text>
    </box>
  );
}

function Changes(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.textMuted}>the editor grid renders here</text>
    </box>
  );
}

function Project(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.textDim}>No changes</text>
    </box>
  );
}

const noop = (): void => {};

export const FourPane: Story = {
  render: () => (
    <AppShell
      sidebarOpen
      onToggleSidebar={noop}
      onOpenMenu={noop}
      threadsPanel={<Threads />}
      threadTitle="Read Cueloop Repository"
      threadPanel={<Thread />}
      changesOpen
      projectOpen
      onToggleChanges={noop}
      onToggleProject={noop}
      onToggleRight={noop}
      projectMode="changes"
      changesPanel={<Changes />}
      projectPanel={<Project />}
    />
  ),
  expectedColors: [DARK.border, DARK.accent],
  size: { width: 130, height: 28 },
};

export const CollapsedRightRail: Story = {
  render: () => (
    <AppShell
      sidebarOpen
      onToggleSidebar={noop}
      onOpenMenu={noop}
      threadsPanel={<Threads />}
      threadTitle="Read Cueloop Repository"
      threadPanel={<Thread />}
      changesOpen={false}
      projectOpen={false}
      onToggleChanges={noop}
      onToggleProject={noop}
      onToggleRight={noop}
      projectMode="tree"
      projectPanel={<Project />}
    />
  ),
  expectedColors: [DARK.border],
  size: { width: 100, height: 22 },
};
