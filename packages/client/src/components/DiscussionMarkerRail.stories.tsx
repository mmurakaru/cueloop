import React from "react";
import type { Annotation } from "@cueloop/schema";
import { DARK } from "../theme";
import type { Discussion } from "../discussions";
import type { TextSpan } from "../thread-selection";
import { RootOverlayProvider } from "./RootOverlay";
import { DiscussionMarkerRail } from "./DiscussionMarkerRail";
import type { Story, StoryMeta } from "./story";

export const meta: StoryMeta = { title: "Chrome/DiscussionMarkerRail" };

function comment(id: string, body: string): Annotation {
  return {
    id,
    kind: "comment",
    anchor: { quote: body, prefix: "", suffix: "" },
    body,
    createdAt: "2026-09-08T00:00:00.000Z",
  };
}

function discussion(row: number, body: string): Discussion {
  const span: TextSpan = { start: { blockIndex: row, char: 0 }, end: { blockIndex: row, char: 4 } };

  return {
    key: `${row}`,
    rootId: `a${row}`,
    blockIndex: row,
    span,
    annotations: [comment(`a${row}`, body)],
  };
}

const discussions = [
  discussion(2, "Map needs an eviction story."),
  discussion(5, "why a Map here?"),
  discussion(9, "name this constant"),
];

// The centered dot column: one dot per discussion, drawn on a surface's right edge.
export const Dots: Story = {
  render: () => (
    <RootOverlayProvider>
      <box
        style={{ width: 24, height: 10, flexDirection: "row", backgroundColor: DARK.background }}
      >
        <box style={{ flexGrow: 1 }} />
        <DiscussionMarkerRail discussions={discussions} spanQuote={() => "x"} onJump={() => {}} />
      </box>
    </RootOverlayProvider>
  ),
  expectedColors: [DARK.textDim],
  size: { width: 24, height: 10 },
};
