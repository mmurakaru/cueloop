import { createFxHarness } from "@cueloop/adapters/fx/harness";
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
      adapter: createFxHarness({
        command: [
          process.execPath,
          join(import.meta.dirname, "../../packages/adapters/src/fx/testing/fake-acp.ts"),
        ],
      }),
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

test("an explicit comment submission leaves other notes and Threads untouched", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-comment-scope-"));
  const server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: {
      enabled: true,
      adapter: createFxHarness({
        command: [
          process.execPath,
          join(import.meta.dirname, "../../packages/adapters/src/fx/testing/fake-acp.ts"),
        ],
      }),
    },
  });

  server.start();
  const client = await DaemonClient.connect({ home });

  try {
    const thread = await client.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Review the retry and timeout", meta: {} },
    );
    const other = await client.sessionCreate(
      { repoRoot: home, branch: "other" },
      { type: "plan", content: "Separate document", meta: {} },
    );
    const note = {
      kind: "comment" as const,
      anchor: { quote: "retry", prefix: "Review the ", suffix: " and timeout" },
      body: "An older unsent note",
    };

    await client.sessionAnnotate(thread.id, { ...note, id: "older" });
    await client.sessionAnnotate(thread.id, {
      ...note,
      id: "selected",
      anchor: { quote: "timeout", prefix: "Review the retry and ", suffix: "" },
      body: "Explain only the timeout",
    });
    await client.sessionAnnotate(other.id, {
      ...note,
      id: "other-note",
      anchor: { quote: "Separate", prefix: "", suffix: " document" },
    });
    const otherBefore = await client.sessionGet(other.id);
    const state = await client.agentPrompt({ id: thread.id, text: "", commentId: "selected" });

    expect(state.submissions).toHaveLength(1);
    expect(state.submissions?.[0]?.commentId).toBe("selected");
    expect(state.submissions?.[0]?.prompt).toBe("Explain only the timeout");
    expect(state.submissions?.[0]?.context).not.toContain(note.body);
    expect((await client.agentGet(other.id)).submissions ?? []).toHaveLength(0);
    expect(await client.sessionGet(other.id)).toEqual(otherBefore);
    await client.sessionAnnotate(thread.id, { ...note, id: "older", body: "Still editable" });
    expect(
      (await client.sessionGet(thread.id)).annotations.find((entry) => entry.id === "older")?.body,
    ).toBe("Still editable");
    await expect(
      client.agentPrompt({ id: thread.id, text: "", commentId: "other-note" }),
    ).rejects.toThrow();
  } finally {
    client.close();
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
        adapter: createFxHarness({
          command: [process.env.CUELOOP_TEST_FX!, "acp"],
          env: provider.env,
        }),
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
      const sessionId = state.harness?.sessionId;

      client.close();
      server.stop();
      server = new DaemonServer({
        home,
        idleExitMs: 0,
        threadAgent: {
          enabled: true,
          adapter: createFxHarness({
            command: [process.env.CUELOOP_TEST_FX!, "acp"],
            env: provider.env,
          }),
        },
      });
      server.start();
      client = await DaemonClient.connect({ home });
      await client.agentPrompt({ id: thread.id, text: "" });
      const restored = await wait(thread.id);

      expect(restored.harness?.sessionId).toBe(sessionId);
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
        adapter: createFxHarness({
          command: [process.env.CUELOOP_TEST_FX!, "acp"],
          env: provider.env,
        }),
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
        adapter: createFxHarness({
          command: [process.env.CUELOOP_TEST_FX!, "acp"],
          env: provider.env,
        }),
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

test("harness tools reply to the original Changes discussion and return Approve to the waiting main session", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-tools-"));
  const calls: string[] = [];
  const server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: {
      enabled: true,
      adapter: {
        id: "test-tools",
        label: "Test tools",
        connect(options) {
          return {
            start: async () => "tool-session",
            prompt: async () => {
              const definitions = options.tools!.definitions.map((entry) => entry.name);

              expect(definitions).toContain("reply_to_comment");
              expect(definitions).toContain("send_message");
              const threads = await options.tools!.call(
                "cueloop_api",
                JSON.stringify({
                  method: "session.list",
                  params: {},
                }),
              );

              expect(Array.isArray(JSON.parse(threads))).toBe(true);
              await options.tools!.call(
                "reply_to_comment",
                JSON.stringify({
                  id: currentId,
                  commentId: "changes-comment",
                  body: "This timer clears on completion.",
                }),
              );
              calls.push("reply");
              await options.tools!.call(
                "send_message",
                JSON.stringify({
                  id: currentId,
                  outcome: "approved",
                  summary: "Approve",
                }),
              );
              calls.push("send");
              options.onEvent({ kind: "message", text: "Done!" });

              return { outcome: "completed" };
            },
            cancel() {},
            permission() {},
            close() {},
          };
        },
      },
    },
  });
  let currentId = "";

  server.start();
  const client = await DaemonClient.connect({ home });

  try {
    const thread = await client.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Review timer", meta: {} },
    );

    currentId = thread.id;
    const original = {
      id: "changes-comment",
      kind: "comment",
      anchor: makeAnchor(parseBlocks("clearTimeout(timer)"), 0, 0, 19),
      body: "Explain this and reply here",
      target: { kind: "file" as const, path: "timer.ts", rev: "worktree" as const },
    };

    await client.sessionComment(thread.id, original);
    const waiting = client.sessionWait(thread.id, 3000);

    await client.agentPrompt({ id: thread.id, text: "" });
    await expect(
      client.sessionComment(thread.id, { ...original, body: "Rewrite" }),
    ).rejects.toThrow("read-only");
    await expect(client.sessionRemoveAnnotation(thread.id, original.id)).rejects.toThrow(
      "read-only",
    );
    const returned = await waiting;

    expect(calls).toEqual(["reply", "send"]);
    expect(returned?.message?.outcome).toBe("approved");
    const reply = returned?.annotations.find((entry) => entry.replyTo === original.id);

    expect(reply?.anchor).toEqual(original.anchor);
    expect(reply?.target).toEqual(original.target);
    expect(reply?.body).toBe("This timer clears on completion.");
    expect(returned?.artifact.content).toBe(thread.artifact.content);
  } finally {
    client.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test.skipIf(!process.env.CUELOOP_TEST_FX)(
  "real fx calls cueloop reply and Send message tools over ACP",
  async () => {
    const toolCalls: { name: string; args: Record<string, string> }[] = [];
    const provider = createTestFxProvider({ toolCalls });
    const home = mkdtempSync(join(tmpdir(), "cueloop-real-tools-"));
    const server = new DaemonServer({
      home,
      idleExitMs: 0,
      threadAgent: {
        enabled: true,
        adapter: createFxHarness({
          command: [process.env.CUELOOP_TEST_FX!, "acp"],
          env: provider.env,
        }),
      },
    });

    server.start();
    const client = await DaemonClient.connect({ home });

    try {
      const thread = await client.sessionCreate(
        { repoRoot: provider.workspace, branch: "main" },
        { type: "plan", content: "Review the timer", meta: {} },
      );

      await client.sessionComment(thread.id, {
        id: "original",
        kind: "comment",
        anchor: makeAnchor(parseBlocks(thread.artifact.content), 0, 0, 6),
        body: "Explain then Approve",
      });
      toolCalls.push(
        {
          name: "reply_to_comment",
          args: {
            id: thread.id,
            commentId: "original",
            body: "The timer clears after completion.",
          },
        },
        { name: "send_message", args: { id: thread.id, outcome: "approved", summary: "Approve" } },
      );
      await client.agentPrompt({ id: thread.id, text: "" });
      const deadline = Date.now() + 5000;

      while ((await client.sessionGet(thread.id)).status !== "resolved") {
        const state = await client.agentGet(thread.id);

        if (state.phase.kind === "permission") {
          const option = state.phase.permission.options.find(
            (entry) => entry.kind === "allow_once",
          );

          expect(option).toBeDefined();
          await client.agentPermission({
            id: thread.id,
            requestId: state.phase.permission.id,
            optionId: option!.optionId,
          });
        }

        if (Date.now() > deadline) throw new Error("Real fx cueloop tools did not return feedback");

        await Bun.sleep(5);
      }
      const returned = await client.sessionGet(thread.id);

      expect(returned?.message?.outcome).toBe("approved");
      expect(returned?.annotations.find((entry) => entry.replyTo === "original")?.body).toBe(
        "The timer clears after completion.",
      );
    } finally {
      client.close();
      server.stop();
      provider.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
  15000,
);

test("disabled experimental agents reject all agent socket methods without starting a harness", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-disabled-"));
  const server = new DaemonServer({ home, idleExitMs: 0 });

  server.start();
  const owner = await DaemonClient.connect({ home });

  try {
    const thread = await owner.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Review normally", meta: {} },
    );
    const rejected = await Promise.allSettled([
      owner.agentGet(thread.id),
      owner.agentConfigure({ id: thread.id }),
      owner.agentPrompt({ id: thread.id, text: "Start" }),
      owner.agentCancel(thread.id),
      owner.agentPermission({ id: thread.id, requestId: "permission", optionId: "allow" }),
      owner.agentComment({
        id: thread.id,
        comment: {
          id: "comment",
          messageId: "answer",
          body: "Explain",
          sent: false,
          anchor: makeAnchor(parseBlocks("answer"), 0, 0, 6),
        },
      }),
    ]);

    for (const result of rejected) {
      expect(result.status).toBe("rejected");

      if (result.status === "rejected")
        expect(String(result.reason)).toContain("Thread agent is disabled");
    }
    expect((await owner.sessionGet(thread.id)).annotations).toHaveLength(0);
  } finally {
    owner.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});

test("harness tools cannot inspect or mutate another Thread or repository", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-tool-scope-"));
  let tools: import("@cueloop/schema").AgentHarnessTools | undefined;
  const server = new DaemonServer({
    home,
    idleExitMs: 0,
    threadAgent: {
      enabled: true,
      adapter: {
        id: "test-scope",
        label: "Test scope",
        connect(options) {
          tools = options.tools;

          return {
            start: async () => "scope-session",
            prompt: async () => ({ outcome: "completed" }),
            cancel() {},
            permission() {},
            close() {},
          };
        },
      },
    },
  });

  server.start();
  const client = await DaemonClient.connect({ home });

  try {
    const origin = await client.sessionCreate(
      { repoRoot: home, branch: "main" },
      { type: "plan", content: "Origin", meta: {} },
    );
    const other = await client.sessionCreate(
      { repoRoot: "/unrelated", branch: "main" },
      { type: "plan", content: "Unrelated", meta: {} },
    );

    await client.agentPrompt({ id: origin.id, text: "Review" });
    expect(tools).toBeDefined();
    for (const method of ["session.get", "session.delete", "session.sendMessage"]) {
      await expect(
        tools!.call(
          "cueloop_api",
          JSON.stringify({
            method,
            params: { id: other.id, outcome: "approved", summary: "Hijack" },
          }),
        ),
      ).rejects.toThrow();
    }
    await expect(
      tools!.call("send_message", JSON.stringify({ id: other.id, outcome: "approved" })),
    ).rejects.toThrow();
    await expect(
      tools!.call(
        "reply_to_comment",
        JSON.stringify({ id: other.id, commentId: "missing", body: "Hijack" }),
      ),
    ).rejects.toThrow();
    await expect(
      tools!.call(
        "cueloop_api",
        JSON.stringify({ method: "repo.files", params: { cwd: "/unrelated" } }),
      ),
    ).rejects.toThrow();
    await expect(
      tools!.call(
        "cueloop_api",
        JSON.stringify({
          method: "harness.bindingsForSession",
          params: { harness: "fx", harnessSessionId: "unrelated" },
        }),
      ),
    ).rejects.toThrow();
    const listed = JSON.parse(
      await tools!.call(
        "cueloop_api",
        JSON.stringify({
          method: "session.list",
          params: {},
        }),
      ),
    );

    expect(listed.map((entry: { id: string }) => entry.id)).toEqual([origin.id]);
    const inspected = JSON.parse(
      await tools!.call(
        "cueloop_api",
        JSON.stringify({
          method: "session.get",
          params: { id: origin.id },
        }),
      ),
    );

    expect(inspected.id).toBe(origin.id);
    expect((await client.sessionGet(other.id)).status).toBe("pending");
  } finally {
    client.close();
    server.stop();
    rmSync(home, { recursive: true, force: true });
  }
});
