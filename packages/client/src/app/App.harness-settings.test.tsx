import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { DaemonServer } from "@cueloop/daemon";
import type { ThreadAgentState } from "@cueloop/schema";
import { App } from "./App";
import {
  clickText,
  isolateUserConfig,
  isolatedUserConfigPath,
  renderReadyApp,
  waitForText,
  waitForTextGone,
} from "../testing/test-support";

test("repeated harness toggle failures show feedback without losing the controller binding", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-harness-settings-"));
  const restore = isolateUserConfig(home);
  const server = new DaemonServer({ home, idleExitMs: 0 });

  writeFileSync(isolatedUserConfigPath(home), "[experimental]\nthread_agent = true\n");
  server.start();
  const thread = server.core.sessionCreate({
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "# Switching review", meta: { title: "Switching review" } },
  });
  const state: ThreadAgentState = {
    threadId: thread.id,
    phase: { kind: "idle" },
    messages: [],
    comments: [],
    tools: [],
  };
  let switches = 0;
  const setup = await renderReadyApp(
    <App
      home={home}
      sessionId={thread.id}
      agentClient={{
        agentGet: async () => state,
        agentPrompt: async () => state,
        agentCancel: async () => state,
        agentComment: async () => state,
        agentPermission: async () => state,
        agentConfigure: async (params) => {
          if (!params.configId) return state;

          switches++;
          throw new Error(`Switch failure ${switches}`);
        },
      }}
    />,
    { width: 120, height: 32 },
  );

  try {
    await setup.mockMouse.click(1, 0);
    await waitForText(setup, "settings");
    await clickText(setup, "settings");
    await waitForText(setup, "General");
    await clickText(setup, "Thread ");
    await waitForText(setup, "Harness");
    await clickText(setup, "Harness");
    await waitForText(setup, "Switch failure 1");
    await waitForTextGone(setup, "Switch failure 1");
    await clickText(setup, "Harness");
    await waitForText(setup, "Switch failure 2");
    expect(switches).toBe(2);
  } finally {
    setup.renderer.destroy();
    server.stop();
    restore();
    rmSync(home, { recursive: true, force: true });
  }
});
