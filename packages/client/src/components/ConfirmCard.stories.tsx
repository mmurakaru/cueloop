import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ConfirmCard } from "./ConfirmCard";

export const meta: StoryMeta = { title: "ConfirmCard" };

const callbacks = {
  onInput: () => {},
  onSelectVerdict: () => {},
  onSubmit: () => {},
  onCancel: () => {},
};

export const ApproveDefault: Story = {
  render: () => <ConfirmCard verdict="approve" summary="" {...callbacks} />,
  expectedColors: [DARK.green, DARK.accent],
  size: { width: 40, height: 14 },
};

export const RequestChanges: Story = {
  render: () => (
    <ConfirmCard verdict="request_changes" summary="Tighten the steps." {...callbacks} />
  ),
  expectedColors: [DARK.red],
  size: { width: 40, height: 14 },
};

export const WithViewedSummary: Story = {
  render: () => (
    <ConfirmCard verdict="approve" summary="" viewedSummary="2/3 files viewed" {...callbacks} />
  ),
  expectedColors: [DARK.green, DARK.textDim],
  size: { width: 40, height: 14 },
};
