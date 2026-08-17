import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { DiffSheet } from "./DiffSheet";
import { FIXTURE_PATCH, fixtureDiffRows } from "./story-fixtures";

export const meta: StoryMeta = { title: "DiffSheet" };

export const SignedRows: Story = {
  render: () => <DiffSheet rows={fixtureDiffRows()} cursor={0} annotations={[]} />,
  expectedColors: [DARK.insertedForeground, DARK.deletedForeground],
  size: { width: 90, height: 16 },
};

export const CursorOnAddedLine: Story = {
  render: () => <DiffSheet rows={fixtureDiffRows()} cursor={4} annotations={[]} />,
  expectedColors: [DARK.cursorBackground],
  size: { width: 90, height: 16 },
};

export const AnnotatedLine: Story = {
  render: () => (
    <DiffSheet
      rows={fixtureDiffRows()}
      cursor={0}
      annotations={[
        {
          id: "a_story_diff",
          kind: "comment",
          anchor: {
            // diff anchors quote the row text verbatim, trailing newline included
            quote: FIXTURE_PATCH.split("\n").find((line) => line.startsWith("+  "))!.slice(1) + "\n",
            prefix: "",
            suffix: "",
          },
          body: "Map needs an eviction story.",
          createdAt: "2026-01-01T00:00:00Z",
        },
      ]}
    />
  ),
  expectedColors: [DARK.markCommentBackground],
  size: { width: 90, height: 16 },
};
