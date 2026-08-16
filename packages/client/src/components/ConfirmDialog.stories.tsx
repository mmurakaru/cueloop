import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ConfirmDialog } from "./ConfirmDialog";

export const meta: StoryMeta = { title: "ConfirmDialog" };

const callbacks = { onConfirm: () => {}, onCancel: () => {} };

export const DeletePlan: Story = {
  render: () => (
    <ConfirmDialog
      isOpen
      title=" Delete plan "
      message={'Delete "Auth rollout"? This removes the plan and its review.'}
      {...callbacks}
    />
  ),
  expectedColors: [DARK.backdrop, DARK.panel, DARK.accent],
  size: { width: 64, height: 16 },
};
