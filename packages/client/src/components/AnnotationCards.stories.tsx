import React from "react";
import type { Annotation } from "@cueloop/schema";
import { DARK } from "../theme";
import { annotationPaletteFor } from "../annotation-palette";
import { slashItemsFrom } from "../slash-palette";
import { DEFAULT_QUICK_ACTIONS } from "../config";
import type { Story, StoryMeta } from "./story";
import { CommentRow, ComposerPalette, DiscussionCard } from "./AnnotationCards";

export const meta: StoryMeta = { title: "Chrome/AnnotationCards" };

const palette = annotationPaletteFor(DARK);

function annotation(id: string, body: string, author?: string): Annotation {
  const comment: Annotation = {
    id,
    kind: "comment",
    anchor: { quote: "the daemon", prefix: "", suffix: "" },
    body,
    createdAt: "2026-09-07T10:00:00.000Z",
  };

  if (author !== undefined) comment.author = author;

  return comment;
}

// A two-voice discussion: the owner's comment then a collaborator's reply, each
// segment wearing its own accent edge.
export const TwoVoices: Story = {
  render: () => (
    <DiscussionCard
      tokens={DARK}
      segments={[
        {
          color: palette.cardEdge,
          node: <CommentRow annotation={annotation("a", "Which daemon?")} tokens={DARK} />,
        },
        {
          color: DARK.text,
          node: (
            <CommentRow
              annotation={annotation("b", "The one the CLI spawns.", "fp:collab")}
              tokens={DARK}
            />
          ),
        },
      ]}
    />
  ),
  expectedColors: [palette.cardEdge, DARK.text],
  size: { width: 60, height: 8 },
};

export const FocusedCard: Story = {
  render: () => (
    <DiscussionCard
      focused
      tokens={DARK}
      segments={[
        {
          color: palette.cardEdge,
          node: (
            <CommentRow annotation={annotation("a", "Needs an eviction story.")} tokens={DARK} />
          ),
        },
      ]}
    />
  ),
  expectedColors: [DARK.text],
  size: { width: 60, height: 6 },
};

// The palette a leading "/" opens under the composer, with the second item selected.
export const SlashPaletteOpen: Story = {
  render: () => (
    <ComposerPalette
      slashActive
      slashItems={slashItemsFrom(DEFAULT_QUICK_ACTIONS)}
      slashIndex={1}
      inline={null}
      tokens={DARK}
    />
  ),
  expectedColors: [DARK.accent, DARK.textDim],
  size: { width: 90, height: 8 },
};
