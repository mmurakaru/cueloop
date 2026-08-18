import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { KeybindsDialog } from "./KeybindsDialog";

export const meta: StoryMeta = { title: "KeybindsDialog" };

const SECTIONS = [
  {
    title: "Review",
    entries: [
      { keys: "j / k", label: "move" },
      { keys: "v", label: "span" },
      { keys: "c", label: "comment" },
      { keys: "enter", label: "submit" },
    ],
  },
  {
    title: "Submit",
    entries: [
      { keys: "← / →", label: "verdict" },
      { keys: "esc", label: "cancel" },
    ],
  },
];

export const Cheatsheet: Story = {
  render: () => <KeybindsDialog sections={SECTIONS} />,
  expectedColors: [DARK.accent],
  size: { width: 70, height: 24 },
};
