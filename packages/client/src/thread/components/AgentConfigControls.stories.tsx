import React from "react";
import { DARK } from "../../appearance/theme";
import type { Story, StoryMeta } from "../../stories/story";
import { AgentConfigControls } from "./AgentConfigControls";

export const meta: StoryMeta = { title: "Chrome/AgentConfigControls" };

export const Choices: Story = {
  size: { width: 40, height: 2 },
  expectedColors: [DARK.textMuted],
  render: () => (
    <AgentConfigControls
      theme={DARK}
      onConfigure={() => {}}
      state={{
        threadId: "thread",
        phase: { kind: "idle" },
        messages: [],
        tools: [],
        comments: [],
        configOptions: [
          {
            id: "model",
            name: "Model",
            currentValue: "test",
            options: [{ value: "test", name: "Test model" }],
          },
          {
            id: "effort",
            name: "Reasoning",
            category: "thought_level",
            currentValue: "medium",
            options: [{ value: "medium", name: "Medium" }],
          },
        ],
      }}
    />
  ),
};
