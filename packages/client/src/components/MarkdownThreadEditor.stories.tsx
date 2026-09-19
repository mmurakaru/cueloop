import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { MarkdownThreadEditor } from "./MarkdownThreadEditor";

export const meta: StoryMeta = { title: "Surfaces/MarkdownThreadEditor" };

const SAMPLE = "# Rollout Plan\n\nShip the **store move** behind a `flag`.\n\n- first step\n- second step\n";

export const Editing: Story = {
  render: () => (
    <MarkdownThreadEditor
      initialText={SAMPLE}
      theme={DARK}
      onSaveMarkdown={() => {}}
      onCancelEdit={() => {}}
    />
  ),
  expectedColors: [DARK.textMuted, DARK.textDim],
  size: { width: 60, height: 14 },
};
