import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "../../packages/daemon/src/server";
import { DaemonClient } from "../../packages/daemon/src/client";
import { makeAnchor, parseBlocks } from "@cueloop/schema";
import { createTestFxProvider } from "../helpers/fx-provider";

test("agent socket methods enforce owner access and preserve the original review", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-socket-"));
  const server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: {
      enabled: true,
      command: [
        process.execPath,
        join(import.meta.dirname, "../../packages/daemon/src/testing/fake-fx-acp.ts"),
      ],
    },
  });
  server.start();
  const owner = await DaemonClient.connect({ home });
  const capped = await DaemonClient.connect({ home, role: "agent" });

  try {
    const thread = await owner.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Keep the retry bounded", meta: {} },
    );

    await expect(capped.agentPrompt({ id: thread.id, text: "Bypass owner" })).rejects.toThrow(
      "cannot call agent.prompt",
    );
    await expect(capped.agentGet(thread.id)).rejects.toThrow("cannot call agent.get");
    await owner.subscribe();
    const finished = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Agent event timed out")), 3000);
      const unsubscribe = owner.onEvent((event) => {
        if (event.event === "agent.updated" && event.sessionId === thread.id)
          void owner.agentGet(thread.id).then((state) => {
            if (state.phase.kind === "idle" && state.messages.length === 2) {
              clearTimeout(timer);
              unsubscribe();
              resolve();
            }
          });
      });
    });

    await owner.agentPrompt({ id: thread.id, text: "Explain" });
    await finished;
    const state = await owner.agentGet(thread.id);
    const answer = state.messages[1]!;

    await owner.agentComment({
      id: thread.id,
      comment: {
        id: "comment-test",
        messageId: answer.id,
        anchor: makeAnchor(parseBlocks(answer.text), 0, 0, 9),
        body: "Explain the timer",
        sent: false,
      },
    });
    expect((await owner.sessionGet(thread.id)).artifact.content).toBe(thread.artifact.content);
    expect((await owner.sessionGet(thread.id)).status).toBe("pending");
    expect((await owner.agentGet(thread.id)).comments[0]?.sent).toBe(false);
  } finally {
    owner.close();
    capped.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test.skipIf(!process.env.CUELOOP_TEST_FX)(
  "real fx ACP streams Markdown through the daemon, resumes, and receives anchored feedback",
  async () => {
    const provider = createTestFxProvider({ readFile: true });
    const home = join(provider.home, "cueloop");
    let server = new DaemonServer({
      home,
      idleExitMs: 0,
      threadAgent: {
        enabled: true,
        command: [process.env.CUELOOP_TEST_FX!, "acp"],
        env: provider.env,
      },
    });
    server.start();
    let client = await DaemonClient.connect({ home });

    const wait = async (id: string) => {
      const deadline = Date.now() + 15_000;
      let state = await client.agentGet(id);

      while (
        (state.phase.kind === "running" || state.phase.kind === "permission") &&
        Date.now() < deadline
      ) {
        await Bun.sleep(20);
        state = await client.agentGet(id);
      }
      expect(state.phase).toEqual({ kind: "idle" });

      return state;
    };

    try {
      const thread = await client.sessionCreate(
        { repoRoot: provider.workspace, branch: "main" },
        { type: "plan", content: "Investigate retry cancellation", meta: {} },
      );

      await client.agentPrompt({
        id: thread.id,
        text: "Explain retries",
        context: "The retry timer is not cleared",
      });
      const state = await wait(thread.id);
      const answer = state.messages.find((message) => message.role === "agent")!;

      expect(answer.text).toContain("## Retry explanation");
      expect(answer.complete).toBe(true);
      expect(state.tools.some((tool) => tool.kind === "read" && tool.status === "completed")).toBe(
        true,
      );
      const blocks = parseBlocks(answer.text);
      const index = blocks.findIndex((block) => block.text.includes("The timer"));

      await client.agentComment({
        id: thread.id,
        comment: {
          id: "real-comment",
          messageId: answer.id,
          anchor: makeAnchor(blocks, index, 0, 9),
          body: "Explain the cleanup",
          sent: false,
        },
      });
      const sessionId = state.fxSessionId;
      client.close();
      server.stop();
      server = new DaemonServer({
        home,
        idleExitMs: 0,
        threadAgent: {
          enabled: true,
          command: [process.env.CUELOOP_TEST_FX!, "acp"],
          env: provider.env,
        },
      });
      server.start();
      client = await DaemonClient.connect({ home });
      await client.agentPrompt({ id: thread.id, text: "" });
      const restored = await wait(thread.id);

      expect(restored.fxSessionId).toBe(sessionId);
      expect(restored.messages.filter((message) => message.id === answer.id)).toHaveLength(1);
      expect(restored.comments[0]?.sent).toBe(true);
      expect(JSON.stringify(provider.requests)).toContain("Explain the cleanup");
      expect((await client.sessionGet(thread.id)).artifact.content).toBe(thread.artifact.content);
    } finally {
      client.close();
      server.stop();
      provider.close();
    }
  },
  30_000,
);

test.skipIf(!process.env.CUELOOP_TEST_FX)(
  "real fx waits for permission and a rejected write leaves the file unchanged",
  async () => {
    const provider = createTestFxProvider({ writeFile: true });
    const home = join(provider.home, "cueloop");
    const server = new DaemonServer({
      home,
      idleExitMs: 0,
      threadAgent: {
        enabled: true,
        command: [process.env.CUELOOP_TEST_FX!, "acp"],
        env: provider.env,
      },
    });
    server.start();
    const client = await DaemonClient.connect({ home });

    try {
      const thread = await client.sessionCreate(
        { repoRoot: provider.workspace, branch: "main" },
        { type: "plan", content: "Review retry.ts", meta: {} },
      );

      await client.agentPrompt({ id: thread.id, text: "Change the retry delay" });
      let state = await client.agentGet(thread.id);
      const deadline = Date.now() + 5000;

      while (state.phase.kind === "running" && Date.now() < deadline) {
        await Bun.sleep(20);
        state = await client.agentGet(thread.id);
      }
      expect(state.phase.kind).toBe("permission");
      if (state.phase.kind !== "permission") throw new Error(JSON.stringify(state.phase));
      const reject = state.phase.permission.options.find(
        (option) => option.kind === "reject_once",
      )!;

      await client.agentPermission({
        id: thread.id,
        requestId: state.phase.permission.id,
        optionId: reject.optionId,
      });
      while (state.phase.kind !== "idle" && Date.now() < deadline) {
        await Bun.sleep(20);
        state = await client.agentGet(thread.id);
      }
      expect(state.phase.kind).toBe("idle");
      expect(readFileSync(join(provider.workspace, "retry.ts"), "utf8")).toContain(
        "retryDelay = 1000",
      );
    } finally {
      client.close();
      server.stop();
      provider.close();
    }
  },
  15_000,
);

test.skipIf(!process.env.CUELOOP_TEST_FX)(
  "real fx cancellation preserves partial output and returns the Thread to idle",
  async () => {
    const provider = createTestFxProvider({ hold: true });
    const home = join(provider.home, "cueloop");
    const server = new DaemonServer({
      home,
      idleExitMs: 0,
      threadAgent: {
        enabled: true,
        command: [process.env.CUELOOP_TEST_FX!, "acp"],
        env: provider.env,
      },
    });
    server.start();
    const client = await DaemonClient.connect({ home });

    try {
      const thread = await client.sessionCreate(
        { repoRoot: provider.workspace, branch: "main" },
        { type: "plan", content: "Explain cancellation", meta: {} },
      );

      await client.agentPrompt({ id: thread.id, text: "Explain" });
      const deadline = Date.now() + 5000;
      let state = await client.agentGet(thread.id);

      while (state.messages.length < 2 && Date.now() < deadline) {
        await Bun.sleep(20);
        state = await client.agentGet(thread.id);
      }
      expect(state.messages[1]?.text).toContain("Retry explanation");
      await client.agentCancel(thread.id);
      while (state.phase.kind === "running" && Date.now() < deadline) {
        await Bun.sleep(20);
        state = await client.agentGet(thread.id);
      }
      expect(state.phase.kind).toBe("idle");
      expect(state.messages[1]?.text).toContain("Retry explanation");
    } finally {
      client.close();
      server.stop();
      provider.close();
    }
  },
  15_000,
);
