import React from "react";
import { DARK } from "../theme";
import { DEFAULT_QUICK_ACTIONS } from "../config";
import type { Story, StoryMeta } from "./story";
import { ConfirmCard } from "./ConfirmCard";

export const meta: StoryMeta = { title: "Cards/ConfirmCard" };

const callbacks = {
  onInput: () => {},
  onSelectMessage: () => {},
  onSubmit: () => {},
  onCancel: () => {},
  quickActions: DEFAULT_QUICK_ACTIONS,
};

export const ApproveDefault: Story = {
  render: () => <ConfirmCard message="approved" summary="" {...callbacks} />,
  expectedColors: [DARK.green, DARK.accent],
  size: { width: 40, height: 14 },
};

export const RequestChanges: Story = {
  render: () => (
    <ConfirmCard message="changes_requested" summary="Tighten the steps." {...callbacks} />
  ),
  expectedColors: [DARK.red],
  size: { width: 40, height: 14 },
};

export const WithViewedSummary: Story = {
  render: () => (
    <ConfirmCard message="approved" summary="" viewedSummary="2/3 files viewed" {...callbacks} />
  ),
  expectedColors: [DARK.green, DARK.textDim],
  size: { width: 40, height: 14 },
};
