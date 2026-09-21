import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ThreadTree } from "./ThreadTree";
import { groupInbox } from "./thread-tree";
import { fixtureDiffSession, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "Surfaces/ThreadTree" };

/** ThreadTree is the body under App's header/menu chrome; a frame gives it height. */
function BodyFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>{children}</box>;
}

export const TwoPending: Story = {
  render: () => {
    const plan = fixturePlanSession();
    // one repo-bound thread (a project) and one standalone thread
    const projectPlan = {
      ...plan,
      workspace: {
        ...plan.workspace,
        rootCommit: "root-1",
        remote: "git@github.com:acme/widget.git",
      },
    };
    const { rows } = groupInbox([projectPlan, fixtureDiffSession()]);

    return (
      <BodyFrame>
        <ThreadTree rows={rows} cursor={0} />
      </BodyFrame>
    );
  },
  expectedColors: [DARK.accent],
  size: { width: 80, height: 12 },
};

export const Empty: Story = {
  render: () => (
    <BodyFrame>
      <ThreadTree rows={[]} cursor={0} />
    </BodyFrame>
  ),
  size: { width: 80, height: 8 },
};
