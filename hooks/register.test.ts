import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { runHarnessBridge } from "../packages/adapters/harness-bridge";
import { register, type ClaudeModEngine, type ClaudeModOn } from "./register";

type TestInput =
  | { cwd: string; isInteractive: boolean }
  | { tool: string; tool_use_id: string; workflow?: string; content?: string; plan?: string }
  | { trigger: string }
  | { sessionId: string; reason: string };
type TestResult =
  | { cwd: string }
  | { deny: string }
  | { result: string }
  | { messages: object[] }
  | { sessionId: string };
type TestHandler = (
  engine: ClaudeModEngine,
  input: TestInput,
  next: (input: TestInput) => Promise<TestResult>,
) => Promise<TestResult>;

let home: string;
let server: DaemonServer;
let client: DaemonClient;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "cueloop-mod-test-"));
  server = new DaemonServer({ home, idleExitMs: 0 });
  server.start();
  client = await DaemonClient.connect({ home });
});

afterEach(() => {
  client.close();
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

function createTestMod() {
  const handlers = new Map<string, TestHandler>();
  const submitted: string[] = [];
  const stored = new Map<string, boolean>();
  const registered: string[] = [];
  let tick: (() => void) | null = null;
  let failNextAck = false;
  let bridgeUnavailable = false;
  let claudeVersion = "2.1.278 (Claude Code)";
  const engine: ClaudeModEngine = {
    session: { id: async () => "claude-mod-test", cwd: async () => home },
    prompt: {
      submit: async ({ text }) => {
        submitted.push(text);

        return {};
      },
    },
    tool: {
      register: async ({ name }) => {
        registered.push(name);

        return {};
      },
    },
    process: {
      run: async (argv, options) => {
        if (argv[0] === "claude" && argv[1] === "--version") {
          return { exitCode: 0, stdout: claudeVersion, stderr: "" };
        }
        if (!options?.stdin) throw new Error("missing bridge request");
        const request = JSON.parse(options.stdin);

        if (bridgeUnavailable) {
          return { exitCode: 1, stdout: "", stderr: "cueloop harness bridge unavailable" };
        }
        if (request.operation === "ack" && failNextAck) {
          failNextAck = false;

          return { exitCode: 1, stdout: "", stderr: "temporary acknowledgement failure" };
        }
        const response = await runHarnessBridge(request, home);

        return { exitCode: 0, stdout: JSON.stringify(response), stderr: "" };
      },
    },
    env: { get: async () => undefined },
    store: {
      get: async (key) => stored.get(key),
      set: async (key, value) => {
        stored.set(key, value);
      },
    },
    clock: {
      every: (_ms, callback) => {
        tick = callback;

        return {
          cancel: () => {
            tick = null;
          },
        };
      },
    },
  };
  const on: ClaudeModOn = (name, handler) => {
    // SAFETY: dispatch supplies the input and next result for the registered event.
    handlers.set(name, handler as TestHandler);
  };

  register(on);

  async function dispatch(name: string, input: TestInput): Promise<TestResult> {
    const handler = handlers.get(name);

    if (!handler) throw new Error(`missing Mod handler ${name}`);

    return handler(engine, input, async (value) => {
      if (name === "tool.call") {
        return { result: "passed" };
      }
      if ("cwd" in value) {
        return { cwd: value.cwd };
      }
      if ("sessionId" in value) {
        return { sessionId: value.sessionId };
      }

      return { messages: [] };
    });
  }

  return {
    dispatch,
    submitted,
    registered,
    tick: () => tick?.(),
    failAckOnce: () => {
      failNextAck = true;
    },
    setBridgeUnavailable: (unavailable: boolean) => {
      bridgeUnavailable = unavailable;
    },
    setClaudeVersion: (version: string) => {
      claudeVersion = version;
    },
  };
}

async function waitForDelivery(messageCount: number, submitted: string[]): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (submitted.length >= messageCount) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error("Claude Mod did not submit a Message");
}

describe("register Claude Mod", () => {
  test("opens a plan, injects its Message once, and retries a failed acknowledgement", async () => {
    const mod = createTestMod();

    await mod.dispatch("session.start", { cwd: home, isInteractive: true });
    expect(mod.registered).toEqual(["open_thread", "refine_corpus"]);
    const denied = await mod.dispatch("tool.call", {
      tool: "ExitPlanMode",
      tool_use_id: "plan-1",
      plan: "# Plan\n\nShip it.",
    });

    expect(denied).toHaveProperty("deny");
    const [thread] = await client.sessionList({ status: "pending" });

    expect(thread).toBeDefined();
    mod.failAckOnce();
    await client.sessionSendMessage(thread!.id, "approved", "Ready.");
    mod.tick();
    await waitForDelivery(1, mod.submitted);
    mod.tick();
    const [binding] = await client.harnessBindingsForSession("claude-code", "claude-mod-test");

    expect(binding).toBeDefined();
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await client.deliveryPending(binding!.id)).length === 0) break;
      mod.tick();
      await Bun.sleep(10);
    }
    expect(await client.deliveryPending(binding!.id)).toEqual([]);
    expect(mod.submitted).toHaveLength(1);
    expect(mod.submitted[0]).toContain("Ready.");
    const allowed = await mod.dispatch("tool.call", {
      tool: "ExitPlanMode",
      tool_use_id: "plan-2",
      plan: "# Plan\n\nShip it.",
    });

    expect(allowed).toEqual({ result: "passed" });
    expect(
      await mod.dispatch("tool.call", { tool: "Bash", tool_use_id: "bash-after-approval" }),
    ).toEqual({ result: "passed" });
  });

  test("reconciles a Message from before startup and cancels polling at shutdown", async () => {
    const opened = await runHarnessBridge(
      {
        operation: "open",
        harness: "claude-code",
        harnessSessionId: "claude-mod-test",
        cwd: home,
        workflow: "reply",
        content: "# Reply\n\nHello.",
      },
      home,
    );

    expect(opened.operation).toBe("open");
    if (opened.operation !== "open") throw new Error("expected an opened Thread");
    await client.sessionSendMessage(opened.threadId, "changes_requested", "Revise the greeting.");
    const mod = createTestMod();

    await mod.dispatch("session.start", { cwd: home, isInteractive: true });
    expect(mod.submitted).toHaveLength(1);
    expect(mod.submitted[0]).toContain("Revise the greeting.");
    await mod.dispatch("session.compact", { trigger: "manual" });
    expect(mod.submitted).toHaveLength(1);
    await mod.dispatch("session.end", { sessionId: "claude-mod-test", reason: "other" });
    expect(mod.tick()).toBeUndefined();
  });

  test("fails closed while the bridge is unavailable and resumes after recovery", async () => {
    const mod = createTestMod();

    mod.setBridgeUnavailable(true);
    await mod.dispatch("session.start", { cwd: home, isInteractive: true });
    expect(await mod.dispatch("tool.call", { tool: "Bash", tool_use_id: "write" })).toHaveProperty(
      "deny",
    );
    mod.setBridgeUnavailable(false);
    mod.tick();
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await mod.dispatch("tool.call", { tool: "Bash", tool_use_id: "read" });

      if ("result" in result) {
        expect(result.result).toBe("passed");

        return;
      }
      await Bun.sleep(10);
    }
    throw new Error("Claude Mod did not recover after bridge became available");
  });

  test("fails closed on an unsupported Claude Code version", async () => {
    const mod = createTestMod();

    mod.setClaudeVersion("2.1.277 (Claude Code)");
    await mod.dispatch("session.start", { cwd: home, isInteractive: true });
    const denied = await mod.dispatch("tool.call", { tool: "Bash", tool_use_id: "bash-old" });

    expect(denied).toHaveProperty("deny");
    expect("deny" in denied && denied.deny).toContain("2.1.278 or newer");
  });
});
