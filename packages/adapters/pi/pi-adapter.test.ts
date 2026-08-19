/** pi adapter integration: the extension factory run against a fake pi API that captures registrations, with the request_review tool driven end to end against a real daemon in a temp CUELOOP_HOME. */

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

interface FakePi {
  api: PiExtensionAPI;
  tools: Map<string, PiToolDefinition<any, any>>;
  commands: Map<string, PiCommandOptions>;
  toolCallHandlers: PiToolCallHandler[];
}

function createFakePi(): FakePi {
  const tools = new Map<string, PiToolDefinition<any, any>>();
  const commands = new Map<string, PiCommandOptions>();
  const toolCallHandlers: PiToolCallHandler[] = [];
  const api: PiExtensionAPI = {
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, options) => commands.set(name, options),
    on: (_event, handler) => toolCallHandlers.push(handler),
  };
  return { api, tools, commands, toolCallHandlers };
}

function loadExtension(): FakePi {
  const fake = createFakePi();
  createCueloopExtension({ home, pollMs: 250 })(fake.api);
  return fake;
}

function makeContext(notes: string[] = []): PiContext {
  return { cwd: home, ui: { notify: (message) => notes.push(message) } };
}

function toolCall(toolName: string): PiToolCallEvent {
  return { type: "tool_call", toolCallId: "call-" + toolName, toolName, input: {} };
}

function resultText(result: PiToolResult<ReviewDetails>): string {
  return result.content.map((part) => part.text).join("\n");
}

/** Find the pending session created for a specific plan (tests share one home). */
async function waitForPendingSession(marker: string): Promise<string> {
  const client = await DaemonClient.connect({ home, autostart: true });
  try {
    for (let i = 0; i < 100; i++) {
      const pending = await client.sessionList({ status: "pending" });
      const hit = pending.find((candidate) => candidate.artifact.content.includes(marker));
      if (hit) return hit.id;
      await Bun.sleep(50);
    }
    throw new Error(`no pending session for marker ${marker}`);
  } finally {
    client.close();
  }
}

describe("pi adapter: request_review round-trip", () => {
  test("approve resolves to a normal result carrying the feedback", async () => {
    // Arrange
    const fake = loadExtension();
    const tool = fake.tools.get("request_review")!;
    const plan = "# Approve Plan\n\nShip the daemon behind a flag.\n";

    // Act
    const pendingResult = tool.execute("t-approve", { plan }, undefined, undefined, makeContext());
    const sessionId = await waitForPendingSession("Approve Plan");

    // Assert
    const client = await DaemonClient.connect({ home });
    const session = await client.sessionGet(sessionId);
    expect(session.artifact.meta.agent).toBe("pi");
    expect(session.artifact.meta.title).toBe("Approve Plan");

    // Act
    await client.sessionResolve(sessionId, "approve", "Looks good.");
    client.close();
    const result = (await pendingResult) as PiToolResult<ReviewDetails>;

    // Assert
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toContain("# Review: approve");
    expect(resultText(result)).toContain("Looks good.");
    expect(result.details.status).toBe("resolved");
    expect(result.details.verdictKind).toBe("approve");
  }, 15_000);

  test("request_changes resolves to an error result carrying feedback.md; onUpdate reports annotations", async () => {
    // Arrange
    const fake = loadExtension();
    const tool = fake.tools.get("request_review")!;
    const plan = "# Changes Plan\n\nEnable it for everyone immediately.\n";
    const updates: PiToolResult<ReviewDetails>[] = [];

    // Act
    const pendingResult = tool.execute(
      "t-changes",
      { plan },
      undefined,
      (update) => updates.push(update),
      makeContext(),
    );
    const sessionId = await waitForPendingSession("Changes Plan");
    const client = await DaemonClient.connect({ home });
    await client.sessionAnnotate(sessionId, {
      id: "ann-1",
      kind: "comment",
      anchor: { quote: "Enable it for everyone immediately.", prefix: "", suffix: "" },
      body: "Stage the rollout instead.",
    });

    // Assert
    // the next poll chunk re-reads the session and streams the new count
    for (
      let i = 0;
      i < 100 && !updates.some((update) => update.details.annotationCount === 1);
      i++
    ) {
      await Bun.sleep(50);
    }
    expect(updates.some((update) => update.details.annotationCount === 1)).toBe(true);
    expect(updates.at(-1)!.details.status).toBe("pending");

    // Act
    await client.sessionResolve(sessionId, "request_changes", "Too aggressive.");
    client.close();
    const result = (await pendingResult) as PiToolResult<ReviewDetails>;

    // Assert
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("# Review: request changes");
    expect(resultText(result)).toContain("Too aggressive.");
    expect(resultText(result)).toContain("Stage the rollout instead.");
    expect(result.details.verdictKind).toBe("request_changes");
  }, 15_000);

  test("abort returns a clean cancelled error result and releases the write gate", async () => {
    // Arrange
    const fake = loadExtension();
    const tool = fake.tools.get("request_review")!;
    const handler = fake.toolCallHandlers[0]!;
    const controller = new AbortController();
    const plan = "# Abort Plan\n\nSomething slow.\n";

    // Act
    const pendingResult = tool.execute(
      "t-abort",
      { plan },
      controller.signal,
      undefined,
      makeContext(),
    );
    const sessionId = await waitForPendingSession("Abort Plan");

    // Assert
    expect((await handler(toolCall("edit"), makeContext()))?.block).toBe(true);

    // Act
    controller.abort();
    const result = (await pendingResult) as PiToolResult<ReviewDetails>;

    // Assert
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("cancelled");
    expect(result.details.status).toBe("cancelled");
    expect(result.details.sessionId).toBe(sessionId);
    expect(await handler(toolCall("edit"), makeContext())).toBeUndefined();

    // the session outlives the cancelled call; tidy it so later tests see a clean home
    const client = await DaemonClient.connect({ home });
    await client.sessionResolve(sessionId, "comment", "abandoned");
    client.close();
  }, 15_000);
});

describe("pi adapter: tool_call gate", () => {
  test("blocks write tools while pending, allows read-only tools, releases after resolve", async () => {
    // Arrange
    const fake = loadExtension();
    const tool = fake.tools.get("request_review")!;
    const handler = fake.toolCallHandlers[0]!;
    const context = makeContext();

    // Assert
    // no session yet: nothing is blocked
    expect(await handler(toolCall("edit"), context)).toBeUndefined();

    // Act
    const plan = "# Gate Plan\n\nRefactor everything.\n";
    const pendingResult = tool.execute("t-gate", { plan }, undefined, undefined, context);
    const sessionId = await waitForPendingSession("Gate Plan");

    // Assert
    for (const name of ["edit", "write", "bash", "some_custom_tool"]) {
      const decision = await handler(toolCall(name), context);
      expect(decision?.block).toBe(true);
      expect(decision?.reason).toContain("cueloop review pending");
    }
    for (const name of ["read", "grep", "find", "ls", "request_review"]) {
      expect(await handler(toolCall(name), context)).toBeUndefined();
    }

    // Act
    const client = await DaemonClient.connect({ home });
    await client.sessionResolve(sessionId, "approve", "Fine.");
    client.close();
    await pendingResult;

    // Assert
    expect(await handler(toolCall("edit"), context)).toBeUndefined();
    expect(await handler(toolCall("bash"), context)).toBeUndefined();
  }, 15_000);
});

describe("pi adapter: review command", () => {
  test("reports session status via context.ui", async () => {
    // Arrange
    const fake = loadExtension();
    const command = fake.commands.get("review")!;
    const notes: string[] = [];
    const context = makeContext(notes);

    // Act
    // before any review from this extension instance
    await command.handler("", context);

    // Assert
    expect(notes.length).toBe(1);

    // Act
    const tool = fake.tools.get("request_review")!;
    const plan = "# Status Plan\n\nCheck status reporting.\n";
    const pendingResult = tool.execute("t-status", { plan }, undefined, undefined, context);
    const sessionId = await waitForPendingSession("Status Plan");
    await command.handler("", context);

    // Assert
    expect(notes.at(-1)).toContain(sessionId);
    expect(notes.at(-1)).toContain("pending");

    // Act
    const client = await DaemonClient.connect({ home });
    await client.sessionResolve(sessionId, "approve", "OK.");
    client.close();
    await pendingResult;
    await command.handler("", context);

    // Assert
    expect(notes.at(-1)).toContain("resolved: approve");
  }, 15_000);
});
