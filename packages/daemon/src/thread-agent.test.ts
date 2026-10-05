import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, type Thread, type AgentHarnessAdapter } from "@cueloop/schema";
import { ThreadAgentManager } from "./thread-agent";

function createTestThread(home: string): Thread {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "adapter-test",
    workspace: { repoRoot: home, branch: "main" },
    artifact: { type: "plan", content: "Review the retry", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: "2026-10-04",
  };
}

test("a non-ACP harness streams and resumes through the same Thread manager", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-harness-"));
  const thread = createTestThread(home);
  const sessions: (string | undefined)[] = [];
  const adapter: AgentHarnessAdapter = {
    id: "test-native",
    label: "Native agent",
    connect(options) {
      sessions.push(options.sessionId);

      return {
        start: async () => options.sessionId ?? "native-session",
        prompt: async () => {
          options.onEvent({
            kind: "tool",
            id: "read",
            title: "Read retry",
            toolKind: "read",
            status: "completed",
          });
          options.onEvent({ kind: "message", id: crypto.randomUUID(), text: "Native answer" });

          return { outcome: "completed" as const };
        },
        cancel() {},
        permission() {},
        close() {},
      };
    },
  };
  let manager = new ThreadAgentManager({
    home,
    enabled: true,
    adapter,
    getThread: () => thread,
    onChange() {},
  });
  const finish = async () => {
    for (let attempt = 0; manager.get(thread.id).phase.kind !== "idle" && attempt < 100; attempt++)
      await Bun.sleep(1);
    expect(manager.get(thread.id).phase).toEqual({ kind: "idle" });
  };

  try {
    manager.prompt({ id: thread.id, text: "Explain" });
    await finish();
    expect(manager.get(thread.id).harness).toEqual({
      id: "test-native",
      label: "Native agent",
      sessionId: "native-session",
    });
    expect(manager.get(thread.id).messages[1]?.text).toBe("Native answer");
    const promptDiscussion = { id: manager.get(thread.id).submissions![0]!.id };

    expect(manager.isReadOnly(thread.id, promptDiscussion.id)).toBe(true);
    const promptReply = manager.reply(thread.id, promptDiscussion.id, "The prompt is clear");

    expect(promptReply.comments.at(-1)?.replyTo).toBe(promptDiscussion.id);
    const answer = manager.get(thread.id).messages[1]!;

    manager.comment({
      id: thread.id,
      comment: {
        id: "answer-question",
        messageId: answer.id,
        anchor: { quote: "Native", prefix: "", suffix: " answer", blockIndex: 0, start: 0, end: 6 },
        body: "Explain this",
        sent: false,
      },
    });
    const replied = manager.reply(thread.id, "answer-question", "This is the explanation");

    expect(replied.comments.at(-1)).toMatchObject({
      replyTo: "answer-question",
      messageId: answer.id,
      sent: true,
      author: "embedded-agent",
    });
    manager.comment({
      id: thread.id,
      comment: {
        ...replied.comments.find((entry) => entry.id === "answer-question")!,
        id: "answer-followup",
        replyTo: "answer-question",
        body: "Why?",
        sent: false,
      },
    });
    manager.prompt({ id: thread.id, text: "" });
    expect(
      manager.get(thread.id).submissions?.find((entry) => entry.commentId === "answer-followup")
        ?.context,
    ).toContain("This is the explanation");
    await finish();
    manager.dispose();
    manager = new ThreadAgentManager({
      home,
      enabled: true,
      adapter,
      getThread: () => thread,
      onChange() {},
    });
    manager.prompt({ id: thread.id, text: "Continue" });
    await finish();
    expect(sessions).toEqual([undefined, "native-session"]);
    const other = new ThreadAgentManager({
      home,
      enabled: true,
      adapter: { ...adapter, id: "another-agent" },
      getThread: () => thread,
      onChange() {},
    });

    expect(() => other.prompt({ id: thread.id, text: "Mix sessions" })).toThrow(
      "different harness",
    );
    other.dispose();
  } finally {
    manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("the first prototype's fx records migrate without losing session identity", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-harness-migrate-"));
  const thread = createTestThread(home);
  const path = join(home, "thread-agents");

  mkdirSync(path);
  writeFileSync(
    join(path, `${thread.id}.json`),
    JSON.stringify({
      threadId: thread.id,
      fxSessionId: "saved-fx-session",
      phase: { kind: "idle" },
      messages: [],
      tools: [],
      comments: [],
    }),
  );
  const manager = new ThreadAgentManager({
    home,
    enabled: false,
    getThread: () => thread,
    onChange() {},
  });

  try {
    expect(manager.get(thread.id).harness).toEqual({
      id: "fx",
      label: "fx",
      sessionId: "saved-fx-session",
    });
  } finally {
    manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("empty input is a no-op; queued comments freeze once and retries reuse their mirrors", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-queue-"));
  const thread = createTestThread(home);
  const prompts: string[] = [];
  const finishes: ((outcome: "completed" | "cancelled") => void)[] = [];
  const adapter: AgentHarnessAdapter = {
    id: "test",
    label: "Test",
    connect(options) {
      return {
        start: async () => "session",
        prompt: (text) => {
          prompts.push(text);
          options.onEvent({
            kind: "message",
            id: `answer-${prompts.length}`,
            text: `Reply ${prompts.length}`,
          });

          return new Promise((resolve) => finishes.push((outcome) => resolve({ outcome })));
        },
        cancel() {
          finishes.at(-1)?.("cancelled");
        },
        permission() {},
        close() {},
      };
    },
  };
  const manager = new ThreadAgentManager({
    home,
    enabled: true,
    adapter,
    getThread: () => thread,
    onChange() {},
  });
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  try {
    manager.prompt({ id: thread.id, text: "" });
    expect(prompts).toEqual([]);
    expect(manager.get(thread.id).messages).toEqual([]);
    thread.annotations.push({
      id: "first",
      kind: "comment",
      body: "Explain first",
      anchor: {
        quote: "Review",
        prefix: "",
        suffix: " the retry",
        blockIndex: 0,
        start: 0,
        end: 6,
      },
      createdAt: thread.createdAt,
    });
    manager.prompt({ id: thread.id, text: "" });
    await tick();
    expect(manager.isReadOnly(thread.id, "first")).toBe(true);
    thread.annotations.push({ ...thread.annotations[0]!, id: "second", body: "Explain second" });
    manager.prompt({ id: thread.id, text: "" });
    expect(prompts).toHaveLength(1);
    expect(manager.get(thread.id).submissions?.map((entry) => entry.status)).toEqual([
      "running",
      "queued",
    ]);
    finishes[0]!("completed");
    await tick();
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Input: Explain second");
    expect(prompts[1]).toContain("Reply 1");
    finishes[1]!("cancelled");
    await tick();
    const failed = manager.get(thread.id).submissions![1]!;
    const mirrors = manager.get(thread.id).messages.filter((entry) => entry.role === "user");

    manager.prompt({ id: thread.id, text: "", retry: failed.id });
    await tick();
    expect(manager.get(thread.id).messages.filter((entry) => entry.role === "user")).toEqual(
      mirrors,
    );
    expect(manager.isReadOnly(thread.id, "second")).toBe(true);
    finishes[2]!("completed");
    await tick();
    expect(manager.get(thread.id).submissions?.map((entry) => entry.status)).toEqual([
      "completed",
      "completed",
    ]);
    manager.prompt({ id: thread.id, text: "" });
    expect(prompts).toHaveLength(3);
  } finally {
    manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("rejected first batches leave originals editable and create no queued turn", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-rejected-"));
  const thread = createTestThread(home);
  const manager = new ThreadAgentManager({
    home,
    enabled: true,
    adapter: {
      id: "test",
      label: "Test",
      connect() {
        throw new Error("A rejected batch must not start");
      },
    },
    getThread: () => thread,
    onChange() {},
  });
  const original = {
    id: "valid",
    kind: "comment",
    body: "Explain",
    anchor: { quote: "Review", prefix: "", suffix: " the retry", blockIndex: 0, start: 0, end: 6 },
    createdAt: thread.createdAt,
  };

  try {
    thread.annotations.push(original, { ...original, id: "oversized", body: "x".repeat(320001) });
    expect(() => manager.prompt({ id: thread.id, text: "" })).toThrow("320 KiB");
    expect(manager.get(thread.id).messages).toEqual([]);
    expect(manager.get(thread.id).submissions).toBeUndefined();
    expect(manager.isReadOnly(thread.id, "valid")).toBe(false);
  } finally {
    manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("prompt operation receipts survive restart without requeueing accepted inputs", () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-receipt-"));
  const thread = createTestThread(home);
  const adapter: AgentHarnessAdapter = {
    id: "receipt-test",
    label: "Receipt test",
    connect: () => ({
      start: async () => "session",
      prompt: () => new Promise(() => {}),
      cancel() {},
      permission() {},
      close() {},
    }),
  };
  const options = { home, enabled: true, adapter, getThread: () => thread, onChange() {} };
  let manager = new ThreadAgentManager(options);

  try {
    const input = { id: thread.id, text: "Once", operationId: "once" };
    const accepted = manager.prompt(input);

    manager.dispose();
    manager = new ThreadAgentManager(options);
    const replay = manager.prompt(input);

    expect(replay.promptOperations?.[0]?.result).toEqual(accepted.promptOperations?.[0]?.result);
    expect(replay.submissions).toHaveLength(1);
    expect(replay.promptOperations?.[0]?.outcome).toBe("failed");
    expect(() => manager.prompt({ ...input, text: "Different" })).toThrow(
      "Operation payload conflict",
    );
    manager.prompt({
      id: thread.id,
      text: "",
      retry: replay.submissions![0]!.id,
      operationId: "retry",
    });
    expect(manager.get(thread.id).promptOperations?.[0]?.outcome).toBe("failed");
  } finally {
    manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});

test("retrying accepted work after a failed running-state save starts the harness once", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-start-save-"));
  const thread = createTestThread(home);
  const blockedPath = join(home, "thread-agents", `${thread.id}.json.tmp`);
  let saves = 0;
  let prompts = 0;
  const started = Promise.withResolvers<void>();
  const adapter: AgentHarnessAdapter = {
    id: "start-save-test",
    label: "Start save test",
    connect: () => ({
      start: async () => "session",
      prompt: () => {
        prompts++;
        started.resolve();

        return new Promise(() => {});
      },
      cancel() {},
      permission() {},
      close() {},
    }),
  };
  const manager = new ThreadAgentManager({
    home,
    enabled: true,
    adapter,
    getThread: () => thread,
    onChange() {
      if (++saves === 1) mkdirSync(blockedPath);
    },
  });

  try {
    const input = { id: thread.id, text: "Start once", operationId: "start-once" };

    expect(() => manager.prompt(input)).toThrow();
    expect(manager.get(thread.id).phase.kind).toBe("idle");
    expect(manager.get(thread.id).submissions?.[0]?.status).toBe("queued");
    expect(prompts).toBe(0);
    const acceptedIds = manager.get(thread.id).promptOperations?.[0]?.result;

    rmSync(blockedPath, { recursive: true });
    const replay = manager.prompt(input);

    expect(replay.promptOperations?.[0]?.result).toEqual(acceptedIds);
    expect(replay.submissions).toHaveLength(1);
    await started.promise;
    expect(prompts).toBe(1);
    manager.prompt(input);
    expect(prompts).toBe(1);
  } finally {
    manager.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});
