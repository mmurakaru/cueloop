import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { PaneGrid } from "./PaneGrid";

export const meta: StoryMeta = { title: "Layout/PaneGrid" };

function Sidebar(): React.ReactNode {
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

function Main(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.text}>read the repo</text>
      <text> </text>
      <text fg={DARK.textMuted}>Repository context loaded. main is clean.</text>
      <text> </text>
      <text fg={DARK.text}>Core architecture</text>
      <text fg={DARK.textMuted}> - packages/schema is the dependency root</text>
      <text fg={DARK.textMuted}> - packages/daemon owns session state</text>
    </box>
  );
}

function Inspector(): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <text fg={DARK.text}>cueloop/main</text>
      <text fg={DARK.textDim}> No changes</text>
    </box>
  );
}

function Header(): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", paddingLeft: 1 }}>
      <text fg={DARK.textMuted}>Read Cueloop Repository</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={DARK.textDim}>markdown.test.ts</text>
    </box>
  );
}

function Footer(): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", paddingLeft: 1 }}>
      <text fg={DARK.textDim}>cueloop / main</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={DARK.textDim}>Fable 5</text>
    </box>
  );
}

export const ThreePane: Story = {
  render: () => (
    <PaneGrid
      sidebar={<Sidebar />}
      main={<Main />}
      mainHeader={<Header />}
      inspector={<Inspector />}
      footer={<Footer />}
    />
  ),
  expectedColors: [DARK.border, DARK.accent],
  size: { width: 120, height: 28 },
};

export const SidebarAndMain: Story = {
  render: () => <PaneGrid sidebar={<Sidebar />} main={<Main />} />,
  expectedColors: [DARK.border],
  size: { width: 90, height: 20 },
};
