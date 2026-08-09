import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { CompletionOverlay } from "./CompletionOverlay";

export const meta: StoryMeta = { title: "CompletionOverlay" };

export const ApprovedPrompt: Story = {
  render: () => <CompletionOverlay verdict="approve" completion={{ phase: "prompt" }} status="" />,
  expectedColors: [DARK.green],
};

export const FeedbackCounting: Story = {
  render: () => (
    <CompletionOverlay
      verdict="request_changes"
      completion={{ phase: "counting", remaining: 3 }}
      status="exported to vault/cueloop/plan.md"
      returnsTo="agent/worker-3"
    />
  ),
  expectedColors: [DARK.accent],
};
