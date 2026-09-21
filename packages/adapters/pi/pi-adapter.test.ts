import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { WORKFLOW_KINDS } from "@cueloop/schema";
import { createCueloopExtension, type OpenThreadParams } from "./index";
import type {
  PiCommandOptions,
  PiContext,
  PiExtensionAPI,
  PiSessionEvent,
  PiToolCallEvent,
  PiToolCallHandler,
  PiToolDefinition,
} from "./pi-types";

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "cueloop-pi-"));
});
afterAll(async () => {
  try {
    const client = await DaemonClient.connect({ home });

    await client.shutdown();
    client.close();
  } catch {}
  rmSync(home, { recursive: true, force: true });
});

interface FakePi {
  tools: Map<string, PiToolDefinition<any, any>>;
  commands: Map<string, PiCommandOptions>;
  wakes: string[];
  messageAttempts(): number;
  gate: PiToolCallHandler;
  fire(event: PiSessionEvent["type"], sessionId?: string): Promise<void>;
}

function context(sessionId = "pi-session-1"): PiContext {
  return { cwd: home, sessionManager: { getSessionId: () => sessionId } };
}

function fakePi(options: { failFirstMessage?: boolean } = {}): FakePi {
  const tools = new Map<string, PiToolDefinition<any, any>>();
  const commands = new Map<string, PiCommandOptions>();
  const wakes: string[] = [];
  const handlers = new Map<
    PiSessionEvent["type"],
    ((event: PiSessionEvent, ctx: PiContext) => void | Promise<void>)[]
  >();
  let gate: PiToolCallHandler = () => undefined;
  let failFirstMessage = options.failFirstMessage ?? false;
  let attempts = 0;
  const api: PiExtensionAPI = {
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    sendUserMessage: (message) => {
      attempts += 1;
      if (failFirstMessage) {
        failFirstMessage = false;
        throw new Error("native pi message injection failed");
      }
      wakes.push(message);
    },
    on(event: PiSessionEvent["type"] | "tool_call", handler: any) {
      if (event === "tool_call") {
        gate = handler;

        return;
      }
      const registered = handlers.get(event) ?? [];

      registered.push(handler);
      handlers.set(event, registered);
    },
  };

  createCueloopExtension({ home })(api);

  return {
    tools,
    commands,
    wakes,
    messageAttempts: () => attempts,
    gate: (event, ctx) => gate(event, ctx),
    async fire(event, sessionId = "pi-session-1") {
      for (const handler of handlers.get(event) ?? [])
        await handler({ type: event }, context(sessionId));
    },
  };
}

async function open(fake: FakePi, params: OpenThreadParams, sessionId = "pi-session-1") {
  return fake.tools
    .get("open_thread")!
    .execute("call-1", params, undefined, undefined, context(sessionId));
}

async function waitForWake(fake: FakePi): Promise<void> {
  for (let attempt = 0; attempt < 100 && fake.wakes.length === 0; attempt++) await Bun.sleep(20);
}

function toolCall(name: string): PiToolCallEvent {
  return { type: "tool_call", toolCallId: `call-${name}`, toolName: name, input: {} };
}

describe("pi Thread adapter", () => {
  test("advertises the six shared workflows", () => {
    const fake = fakePi();
    const tool = fake.tools.get("open_thread")!;

    expect(tool.parameters.properties.workflow?.enum).toEqual(WORKFLOW_KINDS);
    expect(fake.tools.has("refine_corpus")).toBe(true);
    expect(fake.commands.has("threads")).toBe(true);
  });

  test("opens a plan, gates mutations, and injects and acknowledges its Message", async () => {
    const fake = fakePi();
    const opened = await open(fake, { workflow: "plan", content: "# Pi Plan\n\nShip it." });
    const threadId = opened.details.sessionId!;

    expect(opened.details.status).toBe("pending");
    expect((await fake.gate(toolCall("write"), context()))?.block).toBe(true);
    expect(await fake.gate(toolCall("read"), context())).toBeUndefined();

    const client = await DaemonClient.connect({ home });

    await client.sessionSendMessage(threadId, "approved", "Looks good.");
    await waitForWake(fake);

    expect(fake.wakes).toHaveLength(1);
    expect(fake.wakes[0]).toContain("Looks good.");
    expect(await fake.gate(toolCall("write"), context())).toBeUndefined();
    const bindings = await client.harnessBindingsForSession("pi", "pi-session-1");

    expect(await client.deliveryPending(bindings[0]!.id)).toEqual([]);
    client.close();
    await fake.fire("session_shutdown");
  });

  test("keeps the mutation gate closed and retries when native Message injection fails", async () => {
    const fake = fakePi({ failFirstMessage: true });
    const opened = await open(fake, { workflow: "plan", content: "# Retry delivery" }, "pi-retry");
    const client = await DaemonClient.connect({ home });

    await client.sessionSendMessage(opened.details.sessionId!, "approved", "Try again.");
    for (let attempt = 0; attempt < 100 && fake.messageAttempts() === 0; attempt++)
      await Bun.sleep(10);
    expect(fake.messageAttempts()).toBe(1);
    expect((await fake.gate(toolCall("write"), context("pi-retry")))?.block).toBe(true);
    const [binding] = await client.harnessBindingsForSession("pi", "pi-retry");

    expect(await client.deliveryPending(binding!.id)).toHaveLength(1);
    await waitForWake(fake);
    expect(fake.wakes).toHaveLength(1);
    expect(fake.messageAttempts()).toBe(2);
    expect(await fake.gate(toolCall("write"), context("pi-retry"))).toBeUndefined();
    client.close();
    await fake.fire("session_shutdown", "pi-retry");
  });

  test("reconnects after the daemon exits and replays a pending Message", async () => {
    const fake = fakePi();
    const opened = await open(
      fake,
      { workflow: "plan", content: "# Restart delivery" },
      "pi-restart",
    );
    const oldDaemon = await DaemonClient.connect({ home });

    await oldDaemon.shutdown();
    oldDaemon.close();
    const replacement = await DaemonClient.connect({ home, autostart: true });

    await replacement.sessionSendMessage(opened.details.sessionId!, "approved", "After restart.");
    await waitForWake(fake);
    expect(fake.wakes).toHaveLength(1);
    expect(fake.wakes[0]).toContain("After restart.");
    replacement.close();
    await fake.fire("session_shutdown", "pi-restart");
  });

  test("rejects malformed host tool input before opening a Thread", async () => {
    const fake = fakePi();
    const result = await fake.tools
      .get("open_thread")!
      .execute(
        "invalid-call",
        { workflow: "plan", content: { unexpected: true } },
        undefined,
        undefined,
        context("pi-invalid"),
      );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("pi Thread request is invalid");
  });

  test("opens reply, prototype, and diff in the canonical panels", async () => {
    const fake = fakePi();

    for (const workflow of ["reply", "prototype", "diff"] as const) {
      const opened = await open(fake, { workflow, content: `${workflow} content` });

      expect(opened.details.status).toBe("pending");
      expect(opened.details.sessionId).toBeDefined();
    }
    await fake.fire("session_shutdown");
  });

  test("refine analyzes the corpus and opens its proposal as a Thread", async () => {
    const fake = fakePi();
    const report = await fake.tools
      .get("refine_corpus")!
      .execute("refine-report", {}, undefined, undefined, context("pi-refine"));

    expect(report.content[0]?.text).toContain("# refine report");
    const opened = await open(
      fake,
      { workflow: "refine", proposal: "# Improve future Threads" },
      "pi-refine",
    );

    expect(opened.details.status).toBe("pending");
    await fake.fire("session_shutdown", "pi-refine");
  });

  test("review imports a PR diff, then posts and injects the Message", async () => {
    const binDirectory = join(home, "fake-gh-bin");

    mkdirSync(binDirectory, { recursive: true });
    const commandPath = join(binDirectory, "gh");

    writeFileSync(
      commandPath,
      "#!/bin/sh\nif [ \"$2\" = diff ]; then printf 'diff --git a/a.ts b/a.ts\\n--- a/a.ts\\n+++ b/a.ts\\n@@ -0,0 +1 @@\\n+export const ready = true;\\n'; fi\n",
    );
    chmodSync(commandPath, 0o755);
    const previousPath = process.env.PATH;

    process.env.PATH = `${binDirectory}${delimiter}${previousPath ?? ""}`;

    try {
      const fake = fakePi();
      const opened = await open(
        fake,
        { workflow: "review", pullRequestReference: "123" },
        "pi-review",
      );

      expect(opened.details.status).toBe("pending");
      const client = await DaemonClient.connect({ home });

      await client.sessionSendMessage(opened.details.sessionId!, "approved", "Ready to merge.");
      await waitForWake(fake);
      expect(fake.wakes[0]).toContain("Ready to merge.");
      client.close();
      await fake.fire("session_shutdown", "pi-review");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  test("reload reconciles a pending Thread without injecting into the old conversation", async () => {
    const first = fakePi();
    const opened = await open(first, { workflow: "plan", content: "# Resume Plan" }, "pi-reload");

    await first.fire("session_shutdown", "pi-reload");
    const second = fakePi();

    await second.fire("session_start", "pi-reload");
    expect((await second.gate(toolCall("edit"), context("pi-reload")))?.block).toBe(true);

    const client = await DaemonClient.connect({ home });

    await client.sessionSendMessage(opened.details.sessionId!, "changes_requested", "Revise it.");
    await waitForWake(second);

    expect(first.wakes).toEqual([]);
    expect(second.wakes).toHaveLength(1);
    expect(second.wakes[0]).toContain("Revise it.");
    client.close();
    await second.fire("session_shutdown", "pi-reload");
  });

  test("session replacement releases the old gate and does not target its new conversation", async () => {
    const fake = fakePi();
    const opened = await open(fake, { workflow: "plan", content: "# Old Plan" }, "pi-old");

    await fake.fire("session_switch", "pi-new");
    expect(await fake.gate(toolCall("edit"), context("pi-new"))).toBeUndefined();

    const client = await DaemonClient.connect({ home });

    await client.sessionSendMessage(opened.details.sessionId!, "approved", "Old response.");
    await Bun.sleep(100);

    expect(fake.wakes).toEqual([]);
    client.close();
    await fake.fire("session_shutdown", "pi-new");
  });
});
