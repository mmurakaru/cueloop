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
