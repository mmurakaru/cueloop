import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { InboxList } from "./InboxList";
import { fixtureDiffSession, fixturePlanSession } from "./story-fixtures";

export const meta: StoryMeta = { title: "InboxList" };

export const TwoPending: Story = {
  render: () => <InboxList inbox={[fixturePlanSession(), fixtureDiffSession()]} cursor={0} />,
  expectedColors: [DARK.accent, DARK.cursorBg],
  size: { width: 80, height: 12 },
};

export const Empty: Story = {
  render: () => <InboxList inbox={[]} cursor={0} />,
  size: { width: 80, height: 8 },
};
