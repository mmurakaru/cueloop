import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ConfirmDialog } from "./ConfirmDialog";

export const meta: StoryMeta = { title: "Overlays/ConfirmDialog" };

const callbacks = { onConfirm: () => {}, onCancel: () => {} };

export const DeleteThread: Story = {
  render: () => (
    <ConfirmDialog
      isOpen
      title=" delete thread "
      message={'Delete "Auth rollout"? This removes the thread.'}
      {...callbacks}
    />
  ),
  expectedColors: [DARK.accent],
  size: { width: 64, height: 16 },
};
