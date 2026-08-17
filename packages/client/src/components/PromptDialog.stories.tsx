import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { PromptDialog } from "./PromptDialog";

export const meta: StoryMeta = { title: "PromptDialog" };

export const RenameAuthor: Story = {
  render: () => (
    <PromptDialog
      isOpen
      title=" Rename author "
      label="Display name for this collaborator:"
      value="Robin"
      placeholder="their name"
      onInput={() => {}}
    />
  ),
  expectedColors: [DARK.backdrop, DARK.elevated, DARK.accent],
  size: { width: 64, height: 16 },
};

export const NameYourself: Story = {
  render: () => (
    <PromptDialog
      isOpen
      title=" Welcome "
      label="Your name (optional) - it attributes the notes you leave:"
      value=""
      placeholder="your name"
      onInput={() => {}}
    />
  ),
  expectedColors: [DARK.backdrop, DARK.elevated],
  size: { width: 64, height: 16 },
};
