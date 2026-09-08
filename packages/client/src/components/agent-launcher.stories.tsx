import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { AgentLauncher } from "./agent-launcher";
import { fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "Chrome/AgentLauncher" };

/** The launcher expects the rail's narrow, height-constrained column. */
function RailFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <box style={{ width: 40, height: 24, paddingLeft: 2, backgroundColor: DARK.panel }}>
      {children}
    </box>
  );
}

export const Launcher: Story = {
  render: () => (
    <RailFrame>
      <AgentLauncher session={fixturePlanSession()} onLaunchHarness={() => {}} theme={DARK} />
    </RailFrame>
  ),
  expectedColors: [DARK.accent],
  size: { width: 40, height: 24 },
};
