import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, type Thread, type AgentHarnessAdapter } from "@cueloop/schema";
import { ThreadAgentManager } from "./thread-agent";

async function waitForTestIdle(manager: ThreadAgentManager, id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const state = manager.get(id);

    if (state.phase.kind === "idle" || state.phase.kind === "failed") return state;
    await Bun.sleep(1);
  }

  throw new Error("Test harness did not settle");
}

for (const first of ["pi", "fx"] as const) {
  test(`handoff ${first} preserves transcript and runtime identity in both directions`, async () => {
    const home = mkdtempSync(join(tmpdir(), "cueloop-switch-"));
    const thread: Thread = {
      schemaVersion: SCHEMA_VERSION,
      id: "switch-test",
      workspace: { repoRoot: home, branch: "main" },
      artifact: { type: "plan", content: "Review retry behavior", meta: {} },
      revisions: [],
      annotations: [],
      message: null,
      status: "pending",
      createdAt: "2026-10-07",
    };
    const prompts: { backend: string; text: string; session?: string }[] = [];
    const adapter = (id: string): AgentHarnessAdapter => ({
      id,
      label: id,
      recovery: "durable",
      connect(options) {
        return {
          start: async () => options.sessionId ?? "shared-runtime",
          async prompt(text) {
            prompts.push({ backend: id, text, session: options.sessionId });
            options.onEvent({
              kind: "message",
              id: crypto.randomUUID(),
              text: text.startsWith("Prepare a continuation")
                ? "Goal: fix retries. Next: test cancellation."
                : `${id} answer`,
            });

            return { outcome: "completed" };
          },
          cancel() {},
          permission() {},
          close() {},
        };
      },
    });
    const adapters = { pi: adapter("pi"), fx: adapter("fx") };
    const manager = new ThreadAgentManager({
      home,
      enabled: true,
      adapter: adapters[first],
      adapters,
      getThread: () => thread,
      onChange() {},
    });
    const target = first === "pi" ? "fx" : "pi";

    try {
      manager.prompt({ id: thread.id, text: "Fix retries" });
      await waitForTestIdle(manager, thread.id);
      const before = manager.get(thread.id).messages;

      await manager.configure({ id: thread.id, configId: "harness", value: target });
      const switched = await waitForTestIdle(manager, thread.id);

      expect(switched.harness).toMatchObject({ id: target, sessionId: "shared-runtime" });
      expect(switched.messages).toEqual(before);
      expect(switched.continuation).toContain("Next: test cancellation");
      manager.prompt({ id: thread.id, text: "Continue with cancellation" });
      await waitForTestIdle(manager, thread.id);
      const received = prompts.at(-1)!;

      expect(received.backend).toBe(target);
      expect(received.session).toBe("shared-runtime");
      expect(received.text).toContain("Next: test cancellation");
      expect(received.text).toContain("Current request:");
      expect(manager.get(thread.id).messages.at(-1)?.text).toBe(`${target} answer`);
    } finally {
      await manager.dispose();
      rmSync(home, { recursive: true, force: true });
    }
  });
}

test("an active turn finishes before handoff and queued input runs on the new harness", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-switch-busy-"));
  const thread: Thread = {
    schemaVersion: SCHEMA_VERSION,
    id: "busy-switch",
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "Retry plan", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "2026-10-07",
  };
  let finish!: () => void;
  let started!: () => void;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const calls: string[] = [];
  const adapter = (id: string): AgentHarnessAdapter => ({
    id,
    label: id,
    recovery: "durable",
    connect(options) {
      return {
        start: async () => options.sessionId ?? "runtime-busy",
        async prompt(text) {
          calls.push(id);
          if (calls.length === 1) {
            started();
            await paused;
          }
          options.onEvent({
            kind: "message",
            id: crypto.randomUUID(),
            text: text.startsWith("Prepare a continuation")
              ? "Continue the retry work"
              : `${id} response`,
          });

          return { outcome: "completed" };
        },
        cancel() {},
        permission() {},
        close() {},
      };
    },
  });
  const adapters = { pi: adapter("pi"), fx: adapter("fx") };
  const manager = new ThreadAgentManager({
    home,
    enabled: true,
    adapter: adapters.pi,
    adapters,
    getThread: () => thread,
    onChange() {},
  });

  try {
    manager.prompt({ id: thread.id, text: "First" });
    await running;
    const queued = await manager.configure({ id: thread.id, configId: "harness", value: "fx" });

    expect(queued.handoff?.status).toBe("queued");
    expect(calls).toEqual(["pi"]);
    manager.prompt({ id: thread.id, text: "Follow-up" });
    finish();
    const done = await waitForTestIdle(manager, thread.id);

    expect(done.phase.kind).toBe("idle");
    expect(done.harness?.id).toBe("fx");
    expect(calls).toEqual(["pi", "pi", "fx"]);
    expect(done.submissions?.map((submission) => submission.status)).toEqual([
      "completed",
      "completed",
    ]);
  } finally {
    finish();
    await manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("failed incoming initialization keeps the outgoing session and surfaces the failure", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-switch-failure-"));
  const thread: Thread = {
    schemaVersion: SCHEMA_VERSION,
    id: "failed-switch",
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "Retry plan", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "2026-10-07",
  };
  const pi: AgentHarnessAdapter = {
    id: "pi",
    label: "pi",
    recovery: "durable",
    connect(options) {
      return {
        start: async () => options.sessionId ?? "original-runtime",
        async prompt() {
          options.onEvent({ kind: "message", id: crypto.randomUUID(), text: "Continue retries" });

          return { outcome: "completed" };
        },
        cancel() {},
        permission() {},
        close() {},
      };
    },
  };
  const fx: AgentHarnessAdapter = {
    id: "fx",
    label: "fx",
    recovery: "durable",
    connect() {
      return {
        start: async () => {
          throw new Error("Fx executable is unavailable");
        },
        prompt: async () => ({ outcome: "completed" }),
        cancel() {},
        permission() {},
        close() {},
      };
    },
  };
  const manager = new ThreadAgentManager({
    home,
    enabled: true,
    adapter: pi,
    adapters: { pi, fx },
    getThread: () => thread,
    onChange() {},
  });

  try {
    manager.prompt({ id: thread.id, text: "First" });
    await waitForTestIdle(manager, thread.id);
    const messages = manager.get(thread.id).messages;

    await manager.configure({ id: thread.id, configId: "harness", value: "fx" });
    const failed = await waitForTestIdle(manager, thread.id);

    expect(failed.phase).toEqual({ kind: "failed", error: "Fx executable is unavailable" });
    expect(failed.harness).toMatchObject({ id: "pi", sessionId: "original-runtime" });
    expect(failed.messages).toEqual(messages);
    await expect(
      manager.configure({ id: thread.id, configId: "harness", value: "missing" }),
    ).rejects.toThrow("unavailable");
  } finally {
    await manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a recovered prepared handoff restores its source when target startup fails", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-switch-recovery-"));
  const thread: Thread = {
    schemaVersion: SCHEMA_VERSION,
    id: "recover",
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "Review retries", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "2026-10-07",
  };
  const source = { id: "pi", label: "pi", sessionId: "runtime-recovery" };
  const adapters = {
    pi: {
      id: "pi",
      label: "pi",
      recovery: "durable",
      connect() {
        throw new Error("Source must not summarize a prepared handoff");
      },
    },
    fx: {
      id: "fx",
      label: "fx",
      recovery: "durable",
      connect() {
        return {
          start: async () => {
            throw new Error("Target failed after restart");
          },
          prompt: async () => ({ outcome: "completed" }),
          cancel() {},
          permission() {},
          close() {},
        };
      },
    },
  } satisfies Record<string, AgentHarnessAdapter>;

  mkdirSync(join(home, "thread-agents"));
  writeFileSync(
    join(home, "thread-agents/recover.json"),
    JSON.stringify({
      threadId: thread.id,
      harness: { ...source, id: "fx", label: "fx" },
      phase: { kind: "running" },
      messages: [],
      tools: [],
      comments: [],
      handoff: {
        target: "fx",
        source,
        operationId: "switch-recovery",
        status: "prepared",
        text: "Continue retry work",
      },
    }),
  );
  const manager = new ThreadAgentManager({
    home,
    enabled: true,
    adapter: adapters.pi,
    adapters,
    getThread: () => thread,
    onChange() {},
  });

  try {
    await manager.configure({ id: thread.id });
    const state = await waitForTestIdle(manager, thread.id);

    expect(state.phase).toEqual({ kind: "failed", error: "Target failed after restart" });
    expect(state.harness).toEqual(source);
    expect(state.handoff).toBeUndefined();
  } finally {
    await manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a queued switch refreshes its rollback binding after delayed initial startup", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-switch-start-"));
  const thread: Thread = {
    schemaVersion: SCHEMA_VERSION,
    id: "delayed",
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "Review retries", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "2026-10-07",
  };
  let ready!: (id: string) => void;
  let started!: () => void;
  const initializing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const initialized = new Promise<string>((resolve) => {
    ready = resolve;
  });
  const adapters = {
    pi: {
      id: "pi",
      label: "pi",
      recovery: "durable",
      connect(options) {
        return {
          start: () => {
            started();

            return initialized;
          },
          async prompt() {
            options.onEvent({
              kind: "message",
              id: crypto.randomUUID(),
              text: "Continue retry work",
            });

            return { outcome: "completed" };
          },
          cancel() {},
          permission() {},
          close() {},
        };
      },
    },
    fx: {
      id: "fx",
      label: "fx",
      recovery: "durable",
      connect() {
        return {
          start: async () => {
            throw new Error("Target unavailable");
          },
          prompt: async () => ({ outcome: "completed" }),
          cancel() {},
          permission() {},
          close() {},
        };
      },
    },
  } satisfies Record<string, AgentHarnessAdapter>;
  const manager = new ThreadAgentManager({
    home,
    enabled: true,
    adapter: adapters.pi,
    adapters,
    getThread: () => thread,
    onChange() {},
  });

  try {
    manager.prompt({ id: thread.id, text: "Review" });
    await initializing;
    await manager.configure({ id: thread.id, configId: "harness", value: "fx" });
    ready("original-runtime");
    const failed = await waitForTestIdle(manager, thread.id);

    expect(failed.phase).toEqual({ kind: "failed", error: "Target unavailable" });
    expect(failed.harness).toEqual({ id: "pi", label: "pi", sessionId: "original-runtime" });
  } finally {
    ready("original-runtime");
    await manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a resumed summary reuses its frozen prompt despite later queued messages", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-switch-frozen-"));
  const thread: Thread = {
    schemaVersion: SCHEMA_VERSION,
    id: "frozen",
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "Review retries", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "2026-10-07",
  };
  const source = { id: "pi", label: "pi", sessionId: "frozen-runtime" };
  const prompts: string[] = [];
  const adapter = (id: string): AgentHarnessAdapter => ({
    id,
    label: id,
    recovery: "durable",
    connect(options) {
      return {
        start: async () => options.sessionId!,
        async prompt(text) {
          prompts.push(text);
          options.onEvent({ kind: "message", id: "summary", text: "Continue" });

          return { outcome: "completed" };
        },
        cancel() {},
        permission() {},
        close() {},
      };
    },
  });
  const adapters = { pi: adapter("pi"), fx: adapter("fx") };

  mkdirSync(join(home, "thread-agents"));
  writeFileSync(
    join(home, "thread-agents/frozen.json"),
    JSON.stringify({
      threadId: thread.id,
      harness: source,
      phase: { kind: "running" },
      messages: [
        {
          id: "queued-message",
          role: "user",
          text: "Added after summary began",
          complete: true,
          revision: 1,
        },
      ],
      tools: [],
      comments: [],
      handoff: {
        target: "fx",
        source,
        operationId: "frozen-summary",
        status: "summarizing",
        prompt: "Frozen handoff instruction",
      },
    }),
  );
  const manager = new ThreadAgentManager({
    home,
    enabled: true,
    adapter: adapters.pi,
    adapters,
    getThread: () => thread,
    onChange() {},
  });

  try {
    await manager.configure({ id: thread.id });
    const state = await waitForTestIdle(manager, thread.id);

    expect(state.harness?.id).toBe("fx");
    expect(prompts).toEqual(["Frozen handoff instruction"]);
    expect(state.continuation).toBe("Continue");
  } finally {
    await manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});
