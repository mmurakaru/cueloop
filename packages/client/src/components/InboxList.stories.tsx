import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { InboxList } from "./InboxList";
import { fixtureDiffSession, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "InboxList" };

/** InboxList is the body under App's header/menu chrome; a frame gives it height. */
function BodyFrame({ children }: { children: React.ReactNode }): React.ReactNode {
  return <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>{children}</box>;
}

export const TwoPending: Story = {
  render: () => (
    <BodyFrame>
      <InboxList inbox={[fixturePlanSession(), fixtureDiffSession()]} cursor={0} />
    </BodyFrame>
  ),
  expectedColors: [DARK.cursorBackground],
  size: { width: 80, height: 12 },
};

export const Empty: Story = {
  render: () => (
    <BodyFrame>
      <InboxList inbox={[]} cursor={0} />
    </BodyFrame>
  ),
  size: { width: 80, height: 8 },
};
