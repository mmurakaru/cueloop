import React from "react";
import { DEFAULT_QUICK_ACTIONS } from "../../settings/config";
import { DARK } from "../../appearance/theme";
import type { Story, StoryMeta } from "../../stories/story";
import { fixtureDisplay, fixtureMarks, fixturePlanSession } from "../../stories/story-fixtures";
import { ThreadView } from "./ThreadView";

export const meta: StoryMeta = { title: "Surfaces/ThreadView" };

export const InlineThreads: Story = {
  render: () => (
    <ThreadView
      session={fixturePlanSession()}
      display={fixtureDisplay()}
      marks={fixtureMarks()}
      quickActions={DEFAULT_QUICK_ACTIONS}
      observer={false}
      onAnnotate={() => {}}
      onReply={() => {}}
      onUpdateAnnotation={() => {}}
      onExit={() => {}}
    />
  ),
  expectedColors: [DARK.text],
  size: { width: 100, height: 34 },
};
