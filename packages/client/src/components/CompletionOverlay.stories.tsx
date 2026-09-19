import React from "react";
import { DARK } from "../theme";
import type { Story, StoryMeta } from "./story";
import { CompletionOverlay } from "./CompletionOverlay";

export const meta: StoryMeta = { title: "Overlays/CompletionOverlay" };

const noop = () => {};

export const ApprovedPrompt: Story = {
  render: () => (
    <CompletionOverlay
      verdict="approve"
      completion={{ phase: "prompt" }}
      status=""
      onClose={noop}
      onBackToPlan={noop}
      onAlways={noop}
    />
  ),
  expectedColors: [DARK.green],
};

export const FeedbackCounting: Story = {
  render: () => (
    <CompletionOverlay
      verdict="request_changes"
      completion={{ phase: "counting", remaining: 3 }}
      status="exported to vault/cueloop/plan.md"
      returnsTo="agent/worker-3"
      onClose={noop}
      onBackToPlan={noop}
      onAlways={noop}
    />
  ),
  expectedColors: [DARK.accent],
};
