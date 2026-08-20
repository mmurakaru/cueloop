import React from "react";
import { DARK } from "../theme";
import { DEFAULT_QUICK_ACTIONS } from "../config";
import type { Story, StoryMeta } from "./story";
import { MarkerPopover } from "./MarkerPopover";

export const meta: StoryMeta = { title: "MarkerPopover" };

const callbacks = {
  onComment: () => {},
  onCut: () => {},
  onOpenActions: () => {},
  onClose: () => {},
  onPickAction: () => {},
  onBack: () => {},
};

export const Toolbar: Story = {
  render: () => (
    <MarkerPopover view="toolbar" actions={DEFAULT_QUICK_ACTIONS} actionIndex={0} {...callbacks} />
  ),
  expectedColors: [DARK.accent, DARK.red, DARK.textMuted, DARK.textDim],
  size: { width: 60, height: 4 },
};

export const ActionsList: Story = {
  render: () => (
    <MarkerPopover view="actions" actions={DEFAULT_QUICK_ACTIONS} actionIndex={2} {...callbacks} />
  ),
  expectedColors: [DARK.accent, DARK.textMuted, DARK.textDim],
  size: { width: 60, height: 8 },
};
