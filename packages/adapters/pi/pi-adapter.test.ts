/** pi adapter integration: the extension factory run against a fake pi API that captures registrations, sendUserMessage wakes, and lifecycle handlers, with request_review driven end to end against a real daemon in a temp CUELOOP_HOME. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { createCueloopExtension, type ReviewDetails } from "./index";
import type {
  PiCommandOptions,
  PiContext,
  PiExtensionAPI,
  PiSendMessageOptions,
  PiSessionHandler,
  PiToolCallEvent,
  PiToolCallHandler,
  PiToolDefinition,
  PiToolResult,
} from "./pi-types";

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-pi-"));
});
afterAll(async () => {
  try {
    const daemonClient = await DaemonClient.connect({ home });

    await daemonClient.shutdown();
    daemonClient.close();
  } catch {
    // daemon already gone
  }
  rmSync(home, { recursive: true, force: true });
});

interface WakeMessage {
  content: string;
  options?: PiSendMessageOptions;
}

interface FakePi {
  api: PiExtensionAPI;
  tools: Map<string, PiToolDefinition<any, any>>;
  commands: Map<string, PiCommandOptions>;
  toolCallHandler: PiToolCallHandler;
  fireShutdown: () => void;
  wakes: WakeMessage[];
}

function createFakePi(): FakePi {
  const tools = new Map<string, PiToolDefinition<any, any>>();
  const commands = new Map<string, PiCommandOptions>();
  const toolCallHandlers: PiToolCallHandler[] = [];
  const sessionHandlers = new Map<string, PiSessionHandler[]>();
  const wakes: WakeMessage[] = [];
  const on = ((event: string, handler: PiToolCallHandler | PiSessionHandler): void => {
    if (event === "tool_call") {
      toolCallHandlers.push(handler as PiToolCallHandler);

      return;
    }
    const list = sessionHandlers.get(event) ?? [];

    list.push(handler as PiSessionHandler);
    sessionHandlers.set(event, list);
  }) as PiExtensionAPI["on"];
  const api: PiExtensionAPI = {
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, options) => commands.set(name, options),
    on,
    sendUserMessage: (content, options) => wakes.push({ content, options }),
  };

  return {
    api,
    tools,
    commands,
    toolCallHandler: (event, context) => toolCallHandlers[0]!(event, context),
    fireShutdown: () => {
      for (const handler of sessionHandlers.get("session_shutdown") ?? [])
        handler({ type: "session_shutdown" });
    },
    wakes,
  };
}

function loadExtension(): FakePi {
  const fake = createFakePi();

  createCueloopExtension({ home, pollMs: 100 })(fake.api);

  return fake;
}

function makeContext(notes: string[] = []): PiContext {
  return { cwd: home, ui: { notify: (message) => notes.push(message) } };
}

function toolCall(toolName: string): PiToolCallEvent {
  return { type: "tool_call", toolCallId: "call-" + toolName, toolName, input: {} };
}

async function openPending(fake: FakePi, plan: string): Promise<string> {
  const tool = fake.tools.get("request_review")!;
  const result = (await tool.execute(
    "t-" + plan.length,
    { plan },
    undefined,
    undefined,
    makeContext(),
  )) as PiToolResult<ReviewDetails>;

  expect(result.isError).toBeFalsy();
  expect(result.details.status).toBe("pending");
  expect(result.details.sessionId).toBeDefined();

  return result.details.sessionId!;
}

/** Park until the extension has woken the turn at least once, then return the wakes. */
async function waitForWake(fake: FakePi): Promise<WakeMessage[]> {
  for (let i = 0; i < 100 && fake.wakes.length === 0; i++) await Bun.sleep(20);

  return fake.wakes;
}

async function resolve(sessionId: string, kind: "approve" | "request_changes", summary: string) {
  const client = await DaemonClient.connect({ home });

  await client.sessionResolve(sessionId, kind, summary);
  client.close();
}

describe("pi adapter: non-blocking request_review", () => {
  test("returns immediately with the session id, then wakes the turn on approve", async () => {
    // Arrange
    const fake = loadExtension();

    // Act - the tool call resolves without waiting for the verdict
    const sessionId = await openPending(fake, "# Approve Plan\n\nShip the daemon behind a flag.\n");

    // Assert - the session is really open and attributed to pi
    const client = await DaemonClient.connect({ home });
    const session = await client.sessionGet(sessionId);

    client.close();
    expect(session.artifact.meta.agent).toBe("pi");
    expect(session.artifact.meta.title).toBe("Approve Plan");

    // Act - the human approves later; the parked waiter wakes the turn
    await resolve(sessionId, "approve", "Looks good.");
    const wakes = await waitForWake(fake);

    // Assert
    expect(wakes.length).toBe(1);
    expect(wakes[0]!.options?.deliverAs).toBe("followUp");
    expect(wakes[0]!.content).toContain("approved");
    expect(wakes[0]!.content).toContain("# Review: approve");
    expect(wakes[0]!.content).toContain("Looks good.");
  }, 15_000);

  test("a pre-aborted tool call returns cancelled without opening a review", async () => {
    // Arrange
    const fake = loadExtension();
    const tool = fake.tools.get("request_review")!;
    const controller = new AbortController();

    controller.abort();

    // Act
    const result = (await tool.execute(
      "t-pre",
      { plan: "# Never Opens\n\nDo not create a session.\n" },
      controller.signal,
      undefined,
      makeContext(),
    )) as PiToolResult<ReviewDetails>;

    // Assert
    expect(result.isError).toBe(true);
    expect(result.details.status).toBe("cancelled");
    expect(result.details.sessionId).toBeUndefined();
  });

  test("wakes with feedback.md carrying the annotations on request_changes", async () => {
    // Arrange
    const fake = loadExtension();
    const sessionId = await openPending(
      fake,
      "# Changes Plan\n\nEnable it for everyone immediately.\n",
    );

    // Act
    const client = await DaemonClient.connect({ home });

    await client.sessionAnnotate(sessionId, {
      id: "ann-1",
      kind: "comment",
      anchor: { quote: "Enable it for everyone immediately.", prefix: "", suffix: "" },
      body: "Stage the rollout instead.",
    });
    client.close();
    await resolve(sessionId, "request_changes", "Too aggressive.");
    const wakes = await waitForWake(fake);

    // Assert
    expect(wakes.length).toBe(1);
    expect(wakes[0]!.content).toContain("returned changes");
    expect(wakes[0]!.content).toContain("# Review: request changes");
    expect(wakes[0]!.content).toContain("Too aggressive.");
    expect(wakes[0]!.content).toContain("Stage the rollout instead.");
  }, 15_000);
});

describe("pi adapter: tool_call gate", () => {
  test("blocks write tools while pending, allows read-only tools, releases after the wake", async () => {
    // Arrange
    const fake = loadExtension();
    const context = makeContext();

    // Assert - no session yet: nothing is blocked
    expect(await fake.toolCallHandler(toolCall("edit"), context)).toBeUndefined();

    // Act
    const sessionId = await openPending(fake, "# Gate Plan\n\nRefactor everything.\n");

    // Assert - writes blocked, reads pass
    for (const name of ["edit", "write", "bash", "some_custom_tool"]) {
      const decision = await fake.toolCallHandler(toolCall(name), context);

      expect(decision?.block).toBe(true);
      expect(decision?.reason).toContain("cueloop review pending");
    }
    for (const name of ["read", "grep", "find", "ls", "request_review"]) {
      expect(await fake.toolCallHandler(toolCall(name), context)).toBeUndefined();
    }

    // Act - the verdict wakes the turn and clears the pending set
    await resolve(sessionId, "approve", "Fine.");
    await waitForWake(fake);

    // Assert - the gate has released
    expect(await fake.toolCallHandler(toolCall("edit"), context)).toBeUndefined();
    expect(await fake.toolCallHandler(toolCall("bash"), context)).toBeUndefined();
  }, 15_000);
});

describe("pi adapter: session_shutdown", () => {
  test("aborts the parked waiter - a later verdict never wakes a dead session", async () => {
    // Arrange
    const fake = loadExtension();
    const context = makeContext();
    const sessionId = await openPending(fake, "# Shutdown Plan\n\nSomething slow.\n");

    expect((await fake.toolCallHandler(toolCall("edit"), context))?.block).toBe(true);

    // Act - the pi session tears down while the review is still open
    fake.fireShutdown();
    // give the aborted waiter a moment to unwind and release the gate
    for (let i = 0; i < 100 && (await fake.toolCallHandler(toolCall("edit"), context)); i++)
      await Bun.sleep(20);

    // Assert - the gate released without any wake
    expect(await fake.toolCallHandler(toolCall("edit"), context)).toBeUndefined();
    expect(fake.wakes.length).toBe(0);

    // Act - resolving now must not inject into the gone session
    await resolve(sessionId, "approve", "Too late.");
    await Bun.sleep(200);

    // Assert
    expect(fake.wakes.length).toBe(0);
  }, 15_000);
});

describe("pi adapter: review command", () => {
  test("reports session status via context.ui", async () => {
    // Arrange
    const fake = loadExtension();
    const command = fake.commands.get("review")!;
    const notes: string[] = [];
    const context = makeContext(notes);

    // Act - before any review from this extension instance
    await command.handler("", context);

    // Assert
    expect(notes.length).toBe(1);

    // Act
    const sessionId = await openPending(fake, "# Status Plan\n\nCheck status reporting.\n");

    await command.handler("", context);

    // Assert
    expect(notes.at(-1)).toContain(sessionId);
    expect(notes.at(-1)).toContain("pending");

    // Act
    await resolve(sessionId, "approve", "OK.");
    await waitForWake(fake);
    await command.handler("", context);

    // Assert
    expect(notes.at(-1)).toContain("resolved: approve");
  }, 15_000);
});
