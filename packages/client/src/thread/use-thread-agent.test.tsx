import React, { useEffect } from "react";
import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { ThreadAgentState } from "@cueloop/schema";
import { useThreadAgent, type ThreadAgentClient } from "./use-thread-agent";
import { waitForText, settle } from "../testing/test-support";

const initial: ThreadAgentState = {
  threadId: "test",
  phase: { kind: "idle" },
  messages: [],
  tools: [],
  comments: [],
};

test("late configuration and action responses cannot replace a newer accepted state", async () => {
  let state = initial;
  let configure: ((value: ThreadAgentState) => void) | undefined;
  let first: ((value: ThreadAgentState) => void) | undefined;
  let request = async () => false;
  let calls = 0;
  const client: ThreadAgentClient = {
    agentGet: async () => state,
    agentConfigure: async () =>
      new Promise((resolve) => {
        configure = resolve;
      }),
    agentPrompt: async () => {
      if (++calls === 1)
        return new Promise((resolve) => {
          first = resolve;
        });
      state = { ...initial, phase: { kind: "running" } };

      return state;
    },
    agentCancel: async () => state,
    agentComment: async () => state,
    agentPermission: async () => state,
  };
  function TestAgent(): React.ReactNode {
    const agent = useThreadAgent("test", undefined, client);
    useEffect(() => {
      request = () => agent.act((api) => api.agentPrompt({ id: "test", text: "Prompt" }));
    }, [agent]);

    return <text>{agent.state.phase.kind}</text>;
  }
  const setup = await testRender(<TestAgent />, { width: 40, height: 4 });

  try {
    await waitForText(setup, "idle");
    const pending = request();
    await request();
    await waitForText(setup, "running");
    first!(initial);
    await pending;
    configure!(initial);
    await settle(setup);
    expect(setup.captureCharFrame()).toContain("running");
    expect(setup.captureCharFrame()).not.toContain("idle");
  } finally {
    setup.renderer.destroy();
  }
});
