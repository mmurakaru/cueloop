import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { SCHEMA_VERSION, type Thread, type ThreadAgentState } from "@cueloop/schema";
import { AgentThreadPane } from "./AgentThreadPane";
import { DARK } from "../../appearance/theme";
import { locateText, waitForText } from "../../testing/test-support";
import type { ThreadAgentClient } from "../use-thread-agent";

const thread: Thread = {
  schemaVersion: SCHEMA_VERSION,
  id: "thread",
  workspace: { repoRoot: "/tmp/project", branch: "main" },
  artifact: { type: "plan", content: "Original artifact", meta: {} },
  annotations: [],
  revisions: [],
  status: "pending",
  message: null,
  createdAt: "2026-10-04",
};
const noop = () => {};

function createTestAgentClient(initial: ThreadAgentState) {
  let state = initial;
  const prompts: { id: string; text: string; context?: string }[] = [];
  const client: ThreadAgentClient = {
    agentGet: async () => state,
    agentPrompt: async (params) => {
      prompts.push(params);
      state = {
        ...state,
        messages: [
          ...state.messages,
          {
            id: "reply",
            role: "agent",
            text: "The timer survives cancellation.",
            complete: true,
            revision: 1,
          },
        ],
      };

      return state;
    },
    agentCancel: async () => ({ ...state, phase: { kind: "idle" } }),
    agentComment: async (params) => {
      state = { ...state, comments: [...state.comments, params.comment] };
      return state;
    },
    agentPermission: async () => ({ ...state, phase: { kind: "idle" } }),
  };

  return { client, prompts };
}

test("the agent pane submits a question and renders a native answer while preserving access to the artifact", async () => {
  const { client, prompts } = createTestAgentClient({
    threadId: thread.id,
    phase: { kind: "idle" },
    messages: [],
    tools: [],
    comments: [],
  });
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      passage="Keep the retry bounded"
      onActiveChange={noop}
      onOpenFile={noop}
    >
      <text>Original artifact</text>
    </AgentThreadPane>,
    { width: 100, height: 24 },
  );

  try {
    await waitForText(setup, "Ask about this Thread");
    await setup.mockInput.typeText("Explain retries");
    const send = locateText(setup, "Send message (0)");

    await setup.mockMouse.click(send.column, send.row);
    await waitForText(setup, "The timer survives cancellation.");
    expect(prompts[0]?.text).toBe("Explain retries");
    expect(setup.captureCharFrame()).toContain("Workspace: /tmp/project");
    const artifact = locateText(setup, "Artifact");

    await setup.mockMouse.click(artifact.column, artifact.row);
    await waitForText(setup, "Original artifact");
    const ask = locateText(setup, "Ask about passage");

    await setup.mockMouse.click(ask.column, ask.row);
    await waitForText(setup, "Passage: Keep the retry bounded");
  } finally {
    setup.renderer.destroy();
  }
});

test("permission choices and collapsed tool activity remain visible in the Thread", async () => {
  const { client } = createTestAgentClient({
    threadId: thread.id,
    phase: {
      kind: "permission",
      permission: {
        id: "permission-1",
        title: "Run retry tests",
        options: [{ optionId: "deny", name: "Reject once", kind: "reject_once" }],
      },
    },
    messages: [
      { id: "question", role: "user", text: "Check retries", complete: true, revision: 1 },
    ],
    comments: [],
    tools: [
      {
        id: "tool",
        turnId: "question",
        title: "Read retry.ts",
        kind: "read",
        status: "completed",
        output: "Retry source",
        locations: [{ path: "retry.ts" }],
      },
    ],
  });
  const setup = await testRender(
    <AgentThreadPane
      thread={thread}
      client={client}
      focused
      theme={DARK}
      onActiveChange={noop}
      onOpenFile={noop}
    >
      <text>Original artifact</text>
    </AgentThreadPane>,
    { width: 100, height: 24 },
  );

  try {
    await waitForText(setup, "Run retry tests");
    expect(setup.captureCharFrame()).toContain("Reject once");
    expect(setup.captureCharFrame()).toContain("1 tool call");
    expect(setup.captureCharFrame()).not.toContain("Retry source");
    const tools = locateText(setup, "Tools (1)");

    await setup.mockMouse.click(tools.column, tools.row);
    await waitForText(setup, "Retry source");
    expect(setup.captureCharFrame()).toContain("Open retry.ts");
  } finally {
    setup.renderer.destroy();
  }
});
