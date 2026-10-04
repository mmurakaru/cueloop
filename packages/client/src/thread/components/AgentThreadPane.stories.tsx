import React from "react";
import { SCHEMA_VERSION, type Thread, type ThreadAgentState } from "@cueloop/schema";
import { DARK } from "../../appearance/theme";
import type { Story, StoryMeta } from "../../stories/story";
import type { ThreadAgentClient } from "../use-thread-agent";
import { AgentThreadPane } from "./AgentThreadPane";

/** Native agent Thread states run without spawning a process or contacting a model. */
export const meta: StoryMeta = { title: "Surfaces/AgentThreadPane" };
const noop = () => {};
const thread: Thread = {
  schemaVersion: SCHEMA_VERSION,
  id: "agent-story",
  workspace: { repoRoot: "/project", branch: "main" },
  artifact: { type: "plan", content: "Keep the retry bounded.", meta: {} },
  revisions: [],
  annotations: [],
  message: null,
  status: "pending",
  createdAt: "2026-10-04T00:00:00Z",
};
const state: ThreadAgentState = {
  threadId: thread.id,
  harness: { id: "fx", label: "fx" },
  phase: { kind: "idle" },
  comments: [],
  messages: [
    {
      id: "question",
      role: "user",
      text: "Why does the retry survive cancellation?",
      complete: true,
      revision: 1,
    },
    {
      id: "answer",
      role: "agent",
      text: "The timer survives cancellation. Clear it when the request ends.",
      complete: true,
      revision: 1,
    },
  ],
  tools: [
    {
      id: "read",
      turnId: "question",
      title: "Read retry.ts",
      kind: "read",
      status: "completed",
      output: "",
      locations: [],
    },
  ],
};

function renderAgentStory(value: ThreadAgentState): React.ReactNode {
  const client: ThreadAgentClient = {
    agentGet: async () => value,
    agentPrompt: async () => value,
    agentCancel: async () => value,
    agentComment: async () => value,
    agentPermission: async () => value,
  };

  return (
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      <text>Keep the retry bounded.</text>
    </AgentThreadPane>
  );
}

/** A completed answer is a selectable document with grouped tool activity. */
export const CompletedAnswer: Story = {
  render: () => renderAgentStory(state),
  size: { width: 80, height: 28 },
  expectedColors: [DARK.accent],
};

/** A permission request stays beside the conversation until the reviewer responds. */
export const WaitingPermission: Story = {
  render: () =>
    renderAgentStory({
      ...state,
      phase: {
        kind: "permission",
        permission: {
          id: "permission",
          title: "Update retry.ts",
          options: [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
            { optionId: "reject", name: "Reject once", kind: "reject_once" },
          ],
        },
      },
    }),
  size: { width: 80, height: 28 },
  expectedColors: [DARK.accent],
};
