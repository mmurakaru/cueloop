import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { ConfirmCard } from "./ConfirmCard";

export const meta: StoryMeta = { title: "ConfirmCard" };

const callbacks = { onInput: () => {}, onSelectVerdict: () => {}, onSubmit: () => {}, onCancel: () => {} };

export const ApproveDefault: Story = {
  render: () => <ConfirmCard verdict="approve" summary="" annotationCount={0} blockingCount={0} {...callbacks} />,
  expectedColors: [DARK.green, DARK.accent],
  size: { width: 40, height: 14 },
};

export const RequestChanges: Story = {
  render: () => (
    <ConfirmCard verdict="request_changes" summary="Tighten the steps." annotationCount={3} blockingCount={1} {...callbacks} />
  ),
  expectedColors: [DARK.red],
  size: { width: 40, height: 14 },
};
