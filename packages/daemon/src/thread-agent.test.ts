import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SCHEMA_VERSION,
  makeAnchor,
  parseBlocks,
  type Thread,
  type AgentPhase,
} from "@cueloop/schema";
import { ThreadAgentManager } from "./thread-agent";

const homes: string[] = [];
const managers: ThreadAgentManager[] = [];

afterEach(() => {
  for (const manager of managers.splice(0)) manager.dispose();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function createTestAgent() {
  const home = mkdtempSync(join(tmpdir(), "cueloop-agent-"));
  const thread: Thread = {
    schemaVersion: SCHEMA_VERSION,
    id: "thread-test",
    workspace: {
      repoRoot: home,
      branch: "main",
    },
    artifact: { type: "plan", content: "Keep the retry bounded", meta: {} },
    revisions: [],
    annotations: [],
    message: null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  const options = {
    home,
    enabled: true,
    getThread: () => thread,
    command: [process.execPath, join(import.meta.dirname, "testing/fake-fx-acp.ts")],
    onChange: () => {},
  };
  const manager = new ThreadAgentManager(options);

  homes.push(home);
  managers.push(manager);

  return { manager, options, thread };
}

async function waitForAgent(manager: ThreadAgentManager, kind: AgentPhase["kind"]) {
  const deadline = Date.now() + 3000;

  while (manager.get("thread-test").phase.kind !== kind && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  expect(manager.get("thread-test").phase.kind).toBe(kind);
}

test("streams native messages and tools without replacing the artifact, then reloads the exact session", async () => {
  const { manager, options, thread } = createTestAgent();

  manager.prompt({ id: thread.id, text: "Explain retries" });
  await waitForAgent(manager, "idle");
  const state = manager.get(thread.id);

  expect(state.fxSessionId).toBe("fx-test-session");
  expect(state.messages.map((message) => message.text)).toEqual([
    "Explain retries",
    "The timer survives cancellation.",
  ]);
  expect(state.tools[0]?.status).toBe("completed");
  expect(thread.artifact.content).toBe("Keep the retry bounded");
  manager.dispose();
  const restored = new ThreadAgentManager(options);

  managers.push(restored);
  restored.prompt({ id: thread.id, text: "Continue" });
  await waitForAgent(restored, "idle");
  expect(restored.get(thread.id).messages).toHaveLength(4);
  expect(restored.get(thread.id).messages[3]?.text).toBe("Loaded fx-test-session.");
});

test("feedback targets an immutable answer and is delivered only with the next submitted turn", async () => {
  const { manager, thread } = createTestAgent();

  manager.prompt({ id: thread.id, text: "Explain" });
  await waitForAgent(manager, "idle");
  const message = manager.get(thread.id).messages[1]!;

  manager.comment({
    id: thread.id,
    comment: {
      id: "note-1",
      messageId: message.id,
      anchor: makeAnchor(parseBlocks(message.text), 0, 0, 9),
      body: "Prove this",
      sent: false,
    },
  });
  expect(manager.get(thread.id).comments[0]?.sent).toBe(false);
  manager.prompt({ id: thread.id, text: "" });
  await waitForAgent(manager, "idle");
  expect(manager.get(thread.id).comments[0]?.sent).toBe(true);
  expect(manager.get(thread.id).messages.at(-1)?.text).toContain("Prove this");
  expect(() =>
    manager.comment({
      id: thread.id,
      comment: {
        id: "bad",
        messageId: "missing",
        anchor: makeAnchor(parseBlocks(message.text), 0, 0, 9),
        body: "Wrong answer",
        sent: false,
      },
    }),
  ).toThrow();
});

test("serializes turns and cancellation settles before allowing the next prompt", async () => {
  const { manager, thread } = createTestAgent();

  manager.prompt({ id: thread.id, text: "hold" });
  expect(() => manager.prompt({ id: thread.id, text: "overlap" })).toThrow("already running");
  await waitForAgent(manager, "permission");
  manager.cancel(thread.id);
  await waitForAgent(manager, "idle");
  expect(manager.get(thread.id).tools[0]?.status).toBe("cancelled");
});

test("permission replies use only an advertised option and cannot be reused", async () => {
  const { manager, thread } = createTestAgent();

  manager.prompt({ id: thread.id, text: "permission" });
  await waitForAgent(manager, "permission");
  const phase = manager.get(thread.id).phase;

  if (phase.kind !== "permission") throw new Error("Expected permission request");
  expect(() =>
    manager.permission({ id: thread.id, requestId: phase.permission.id, optionId: "invented" }),
  ).toThrow();
  manager.permission({ id: thread.id, requestId: phase.permission.id, optionId: "reject" });
  await waitForAgent(manager, "idle");
  expect(manager.get(thread.id).messages.at(-1)?.text).toBe("Permission rejected.");
  expect(() =>
    manager.permission({ id: thread.id, requestId: phase.permission.id, optionId: "reject" }),
  ).toThrow();
});

test("deleting a Thread stops a pending permission and removes its transcript", async () => {
  const { manager, options, thread } = createTestAgent();

  manager.prompt({ id: thread.id, text: "hold" });
  await waitForAgent(manager, "permission");
  const path = join(options.home, "thread-agents", `${thread.id}.json`);

  expect(existsSync(path)).toBe(true);
  manager.remove(thread.id);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(existsSync(path)).toBe(false);
  expect(manager.get(thread.id).messages).toEqual([]);
});

test("cancelling during initialization allows a later prompt on the same connection", async () => {
  const { manager, thread } = createTestAgent();

  manager.prompt({ id: thread.id, text: "Cancelled question" });
  manager.cancel(thread.id);
  await waitForAgent(manager, "idle");
  expect(manager.get(thread.id).messages).toHaveLength(1);
  manager.prompt({ id: thread.id, text: "Try again" });
  await waitForAgent(manager, "idle");
  expect(manager.get(thread.id).messages.at(-1)?.text).toBe("The timer survives cancellation.");
});

test("a resumed successful turn never finalizes a previously interrupted answer", async () => {
  const { manager, options, thread } = createTestAgent();

  manager.prompt({ id: thread.id, text: "First turn" });
  await waitForAgent(manager, "idle");
  const state = manager.get(thread.id);

  manager.dispose();
  state.messages[1]!.complete = false;
  state.phase = { kind: "running" };
  writeFileSync(join(options.home, "thread-agents", `${thread.id}.json`), JSON.stringify(state));
  const restored = new ThreadAgentManager(options);

  managers.push(restored);
  restored.prompt({ id: thread.id, text: "Resume" });
  await waitForAgent(restored, "idle");
  const messages = restored.get(thread.id).messages;

  expect(messages[1]!.complete).toBe(false);
  expect(messages.at(-1)?.complete).toBe(true);
});
