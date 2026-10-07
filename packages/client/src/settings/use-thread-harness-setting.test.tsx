import { expect, test } from "bun:test";
import React, { useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ThreadAgentClient } from "../thread/use-thread-agent";
import type { ThreadAgentState } from "@cueloop/schema";
import { clickText, isolateUserConfig, waitForText } from "../testing/test-support";
import { useThreadHarnessSetting } from "./use-thread-harness-setting";

function TestHarnessSwitchQueue({ client }: { client: ThreadAgentClient }) {
  const [preferred, setPreferred] = useState("pending");
  const setting = useThreadHarnessSetting({
    thread: { id: "switch-queue" },
    enabled: true,
    owner: true,
    preferred: "pi",
    client,
    onState() {},
    onPreferred: setPreferred,
    onError: (message) => setPreferred(message),
  });

  return (
    <box>
      <text onMouseDown={() => setting.switchHarness("fx")}>Select fx</text>
      <text onMouseDown={() => setting.switchHarness("pi")}>Select pi</text>
      <text>Preference: {preferred}</text>
    </box>
  );
}

test("a delayed switch cannot overtake the latest click or persist an older preference", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-switch-queue-"));
  const restore = isolateUserConfig(home);
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const calls: string[] = [];
  const state: ThreadAgentState = {
    threadId: "switch-queue",
    phase: { kind: "idle" },
    messages: [],
    comments: [],
    tools: [],
  };
  const setup = await testRender(
    <TestHarnessSwitchQueue
      client={{
        agentGet: async () => state,
        agentPrompt: async () => state,
        agentCancel: async () => state,
        agentComment: async () => state,
        agentPermission: async () => state,
        async agentConfigure(params) {
          calls.push(params.value!);

          if (calls.length === 1) {
            started.resolve();
            await release.promise;
          }

          return state;
        },
      }}
    />,
    { width: 60, height: 10 },
  );

  try {
    await waitForText(setup, "Select fx");
    await clickText(setup, "Select fx");
    await started.promise;
    await clickText(setup, "Select pi");
    await clickText(setup, "Select fx");
    await clickText(setup, "Select pi");
    expect(calls).toEqual(["fx"]);
    release.resolve();
    await waitForText(setup, "Preference: pi");
    expect(calls).toEqual(["fx", "pi"]);
  } finally {
    release.resolve();
    setup.renderer.destroy();
    restore();
    rmSync(home, { recursive: true, force: true });
  }
});
