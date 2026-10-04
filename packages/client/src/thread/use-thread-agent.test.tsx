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

test("production subscription shows daemon updates and reconnects without an injected client", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DaemonServer } = await import("@cueloop/daemon");
  const { DaemonClient } = await import("@cueloop/daemon/client");
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-ui-subscription-"));
  const adapter = {
    id: "ui-subscription",
    label: "UI subscription",
    connect({ onEvent }: Parameters<import("@cueloop/schema").AgentHarnessAdapter["connect"]>[0]) {
      return {
        start: async () => "ui-session",
        prompt: async () => {
          onEvent({ kind: "message" as const, id: "answer", text: "Updated answer" });
          return { outcome: "completed" as const };
        },
        cancel() {},
        permission() {},
        close() {},
      };
    },
  };
  const options = { home, idleExitMs: 0, threadAgent: { enabled: true, adapter } };
  let server = new DaemonServer(options);
  server.start();
  const client = await DaemonClient.connect({ home });
  const thread = await client.sessionCreate(
    { repoRoot: home, branch: "main" },
    { type: "plan", content: "Watch this", meta: {} },
  );
  function TestAgentSubscription(): React.ReactNode {
    const agent = useThreadAgent(thread.id, home);

    return (
      <text>
        {agent.client ? "Connected " : "Connecting "}
        {agent.state.messages.map((message) => message.text).join(" ")}
        {agent.error}
      </text>
    );
  }
  const setup = await testRender(<TestAgentSubscription />, { width: 80, height: 4 });

  try {
    await waitForText(setup, "Connected");
    await client.agentPrompt({ id: thread.id, text: "Question" });
    await waitForText(setup, "Updated answer");
    server.stop();
    server = new DaemonServer(options);
    server.start();
    const resumed = await DaemonClient.connect({ home });
    try {
      await resumed.agentPrompt({ id: thread.id, text: "Continuation" });
    } finally {
      resumed.close();
    }
    await waitForText(setup, "Continuation");
    expect(setup.captureCharFrame()).toContain("Updated answer");
  } finally {
    setup.renderer.destroy();
    client.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
