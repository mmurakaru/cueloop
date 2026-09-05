import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { AppShell } from "./AppShell";
import { FileTab } from "./PanelColumn";

export const meta: StoryMeta = { title: "Layout/AppShell" };

function Threads(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.textDim}>Projects</text>
      <text fg={DARK.text}> cueloop</text>
      <box style={{ backgroundColor: DARK.elevated }}>
        <text fg={DARK.accent}> Read Cueloop Repository</text>
      </box>
      <text> </text>
      <text fg={DARK.textDim}>Threads</text>
      <text fg={DARK.textMuted}> Welcome to cueloop</text>
    </box>
  );
}

function Thread(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.text}>read the repo</text>
      <text> </text>
      <text fg={DARK.textMuted}>Repository context loaded. main is clean.</text>
    </box>
  );
}

function Changes(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.textMuted}>markdown.test.ts</text>
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

function Footer(): React.ReactNode {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={DARK.textDim}>cueloop / main</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={DARK.textDim}>Fable 5</text>
    </box>
  );
}

export const FourPane: Story = {
  render: () => (
    <AppShell
      sidebarOpen
      onToggleSidebar={() => {}}
      onOpenMenu={() => {}}
      threadsPanel={<Threads />}
      threadTitle="Read Cueloop Repository"
      threadPanel={<Thread />}
      changesOpen
      onToggleChanges={() => {}}
      changesTab={<FileTab label="markdown.test.ts" active theme={DARK} />}
      changesPanel={<Changes />}
      projectOpen
      onToggleProject={() => {}}
      projectMode="changes"
      onProjectMode={() => {}}
      projectPanel={<Project />}
      footer={<Footer />}
    />
  ),
  expectedColors: [DARK.border, DARK.accent],
  size: { width: 130, height: 28 },
};

export const ThreadAndCenterOnly: Story = {
  render: () => (
    <AppShell
      sidebarOpen
      onToggleSidebar={() => {}}
      onOpenMenu={() => {}}
      threadsPanel={<Threads />}
      threadTitle=""
      threadPanel={<Thread />}
      changesOpen={false}
      onToggleChanges={() => {}}
      changesTab={null}
      changesPanel={null}
      projectOpen={false}
      onToggleProject={() => {}}
      projectMode="changes"
      onProjectMode={() => {}}
      projectPanel={null}
    />
  ),
  expectedColors: [DARK.border],
  size: { width: 90, height: 20 },
};
