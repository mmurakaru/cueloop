import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { ThreadAgentState } from "@cueloop/schema";
import { createThreadHarness } from "../../packages/adapters/src/thread-harness";
import { createFxHarness } from "../../packages/adapters/src/fx/harness";
import { DaemonServer } from "../../packages/daemon/src/server";
import { DaemonClient } from "../../packages/daemon/src/client";

function waitForTestAgent(
  client: DaemonClient,
  id: string,
  matches: (state: ThreadAgentState) => boolean,
) {
  return new Promise<ThreadAgentState>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Test Thread did not reach the expected harness state"));
    }, 5000);
    const read = () =>
      void client.agentGet(id).then((state) => {
        if (state.phase.kind === "failed") {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error(state.phase.error));
        } else if (matches(state)) {
          clearTimeout(timer);
          unsubscribe();
          resolve(state);
        }
      }, reject);
    const unsubscribe = client.onEvent((event) => {
      if (event.event === "agent.updated" && event.sessionId === id) read();
    });

    read();
  });
}

test("owner switches pi to fx and back over the socket without losing Thread state", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-switch-socket-"));
  const models = createModels();
  const faux = fauxProvider();

  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage("Pi initial answer"),
    fauxAssistantMessage("Goal: review retries. Next: continue testing."),
    (context) => {
      expect(JSON.stringify(context.messages)).toContain("The timer survives cancellation");

      return fauxAssistantMessage("Pi continued after fx");
    },
  ]);
  const adapters = {
    pi: createThreadHarness({ home, models }),
    fx: createThreadHarness({
      home,
      models,
      backend: createFxHarness({
        command: [
          process.execPath,
          join(import.meta.dir, "../../packages/adapters/src/fx/testing/fake-acp.ts"),
        ],
      }),
    }),
  };
  const server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: { enabled: true, adapter: adapters.pi, adapters },
  });

  server.start();
  const owner = await DaemonClient.connect({ home });
  const collaborator = await DaemonClient.connect({ home, role: "collaborator" });

  try {
    const thread = await owner.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Review retries", meta: {} },
    );

    await owner.subscribe();
    await expect(
      collaborator.agentConfigure({ id: thread.id, configId: "harness", value: "fx" }),
    ).rejects.toThrow("cannot call agent.configure");
    const first = waitForTestAgent(
      owner,
      thread.id,
      (state) =>
        state.phase.kind === "idle" &&
        state.messages.some((message) => message.text === "Pi initial answer"),
    );

    await owner.agentPrompt({ id: thread.id, text: "Review retries" });
    const original = await first;
    const switched = waitForTestAgent(
      owner,
      thread.id,
      (state) => state.phase.kind === "idle" && state.harness?.id === "fx",
    );

    await owner.agentConfigure({ id: thread.id, configId: "harness", value: "fx" });
    const fx = await switched;

    expect(fx.harness?.sessionId).toBe(original.harness?.sessionId);
    expect(fx.messages).toEqual(original.messages);
    const reply = waitForTestAgent(
      owner,
      thread.id,
      (state) =>
        state.phase.kind === "idle" &&
        state.messages.some((message) => message.text === "The timer survives cancellation."),
    );

    await owner.agentPrompt({ id: thread.id, text: "Continue" });
    await reply;
    const back = waitForTestAgent(
      owner,
      thread.id,
      (state) => state.phase.kind === "idle" && state.harness?.id === "pi",
    );

    await owner.agentConfigure({ id: thread.id, configId: "harness", value: "pi" });
    await back;
    const continued = waitForTestAgent(
      owner,
      thread.id,
      (state) =>
        state.phase.kind === "idle" && state.messages.at(-1)?.text === "Pi continued after fx",
    );

    await owner.agentPrompt({ id: thread.id, text: "Continue again" });
    const final = await continued;

    expect(
      final.messages.filter((message) => message.role === "user").map((message) => message.text),
    ).toEqual(["Review retries", "Continue", "Continue again"]);
    expect((await owner.sessionGet(thread.id)).artifact).toEqual(thread.artifact);
  } finally {
    collaborator.close();
    owner.close();
    await server.shutdown();
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
