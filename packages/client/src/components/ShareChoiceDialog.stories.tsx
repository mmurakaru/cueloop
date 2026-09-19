import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ShareChoiceDialog } from "./ShareChoiceDialog";

export const meta: StoryMeta = { title: "Dialogs/ShareChoice" };

export const PublicSelected: Story = {
  render: () => (
    <ShareChoiceDialog
      isOpen
      selectedIndex={0}
      onPublicShare={() => {}}
      onPrivateShare={() => {}}
      onStopSharing={() => {}}
      canRevoke={false}
      onClose={() => {}}
      theme={DARK}
    />
  ),
  size: { width: 60, height: 12 },
};

export const PrivateSelected: Story = {
  render: () => (
    <ShareChoiceDialog
      isOpen
      selectedIndex={1}
      onPublicShare={() => {}}
      onPrivateShare={() => {}}
      onStopSharing={() => {}}
      canRevoke={false}
      onClose={() => {}}
      theme={DARK}
    />
  ),
  size: { width: 60, height: 12 },
};

export const AlreadyShared: Story = {
  render: () => (
    <ShareChoiceDialog
      isOpen
      selectedIndex={2}
      onPublicShare={() => {}}
      onPrivateShare={() => {}}
      onStopSharing={() => {}}
      canRevoke
      onClose={() => {}}
      theme={DARK}
    />
  ),
  size: { width: 60, height: 12 },
};
