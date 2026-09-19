import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { MarkdownThreadEditor } from "./MarkdownThreadEditor";

export const meta: StoryMeta = { title: "Surfaces/MarkdownThreadEditor" };

const SAMPLE =
  "# Rollout Plan\n\nShip the store move behind a `flag`. See [docs](https://x.dev).\n\n- first step\n- second step\n";

export const Editing: Story = {
  render: () => <MarkdownThreadEditor initialText={SAMPLE} theme={DARK} onExitEditor={() => {}} />,
  expectedColors: [DARK.blue, DARK.textMuted, DARK.textDim],
  size: { width: 62, height: 14 },
};
