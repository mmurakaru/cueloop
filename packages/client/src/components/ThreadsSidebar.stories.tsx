import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ThreadsSidebar } from "./ThreadsSidebar";
import { groupInbox } from "./session-tree";
import { fixtureDiffSession, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "Surfaces/ThreadsSidebar" };

function Frame({ children }: { children: React.ReactNode }): React.ReactNode {
  return <box style={{ width: "100%", height: "100%", flexDirection: "row" }}>{children}</box>;
}

const plan = fixturePlanSession();
const projectPlan = {
  ...plan,
  workspace: { ...plan.workspace, rootCommit: "root-1", remote: "git@github.com:acme/widget.git" },
};
const { rows, ordered } = groupInbox([projectPlan, fixtureDiffSession()]);

export const Open: Story = {
  render: () => (
    <Frame>
      <ThreadsSidebar
        open
        rows={rows}
        cursor={0}
        activeId={ordered[0]!.id}
        onSelect={() => {}}
        theme={DARK}
      />
    </Frame>
  ),
  expectedColors: [DARK.accent, DARK.border],
  size: { width: 60, height: 12 },
};
