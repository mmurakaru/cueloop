import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createModels, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { AgentHarnessAdapter, AgentHarnessEvent } from "@cueloop/schema";
import { createThreadHarness } from "./thread-harness";

function createTestBackend(onPrompt: (text: string) => void): AgentHarnessAdapter {
  return {
    id: "fx",
    label: "fx",
    connect(options) {
      return {
        start: async () => options.sessionId ?? "fx-native-session",
        async prompt(text) {
          onPrompt(text);
          options.onEvent({ kind: "message", id: "fx-answer", text: "Fx reply", replace: true });

          return { outcome: "completed" };
        },
        cancel() {},
        permission() {},
        close() {},
      };
    },
  };
}

test("pi and fx share a runtime while retaining their own backend sessions and receipts", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-shared-runtime-"));
  const models = createModels();
  const faux = fauxProvider();
  const calls: string[] = [];
  const events: AgentHarnessEvent[] = [];
  const backend = createTestBackend((text) => calls.push(text));

  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Pi reply"), fauxAssistantMessage("Pi continued")]);
  const options = {
    cwd: home,
    onEvent: (event: AgentHarnessEvent) => events.push(event),
    onExit() {},
  };
  let connection = createThreadHarness({ home, models }).connect(options);

  try {
    const sessionId = await connection.start();

    await connection.prompt("Pi question", "pi-first");
    await connection.close();
    connection = createThreadHarness({ home, models, backend }).connect({ ...options, sessionId });
    expect(await connection.start()).toBe(sessionId);
    expect(await connection.prompt("Fx question", "fx-first")).toEqual({ outcome: "completed" });
    await connection.close();
    connection = createThreadHarness({ home, models, backend }).connect({ ...options, sessionId });
    await connection.start();
    events.length = 0;
    await connection.prompt("Fx question", "fx-first");
    expect(calls).toEqual(["Fx question"]);
    expect(events).toContainEqual({
      kind: "message",
      id: "fx-answer",
      text: "Fx reply",
      replace: true,
    });
    await expect(connection.prompt("Different question", "fx-first")).rejects.toThrow(
      "reused with different input",
    );
    await connection.close();
    connection = createThreadHarness({ home, models }).connect({ ...options, sessionId });
    await connection.start();
    await connection.prompt("Continue pi", "pi-next");
    expect(events.filter((event) => event.kind === "message").at(-1)).toMatchObject({
      text: "Pi continued",
    });
  } finally {
    await connection.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a crashed fx dispatch is never automatically replayed by the shared runtime", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-acp-crash-"));
  const workerPath = join(home, "worker.ts");
  const marker = join(home, "dispatched");

  writeFileSync(
    workerPath,
    `
import { createThreadHarness } from ${JSON.stringify(import.meta.dir + "/thread-harness.ts")};
import { writeFileSync } from "node:fs";
const connection = createThreadHarness({home:${JSON.stringify(home)},backend:{id:"fx",label:"fx",connect(options){return {
start:async()=>"native-session",prompt:async()=>{options.onEvent({kind:"message",id:"partial",text:"Partial reply"});writeFileSync(${JSON.stringify(marker)},"sent");await new Promise(()=>{});},cancel(){},permission(){},close(){}
}}}}).connect({cwd:${JSON.stringify(home)},sessionId:"runtime-test",onEvent(event){if(event.kind==="message")process.exit(0);},onExit(){}});
await connection.start();
await connection.prompt("Unsafe external operation","crash-request");
`,
  );
  const worker = Bun.spawn([process.execPath, workerPath], { stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(worker.stderr).text();
  let calls = 0;
  const replayed: AgentHarnessEvent[] = [];
  const connection = createThreadHarness({
    home,
    backend: createTestBackend(() => calls++),
  }).connect({
    cwd: home,
    sessionId: "runtime-test",
    onEvent(event) {
      replayed.push(event);
    },
    onExit() {},
  });

  try {
    expect(await worker.exited, await stderr).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("sent");
    await connection.start();
    await expect(connection.prompt("Unsafe external operation", "crash-request")).rejects.toThrow(
      "interrupted after dispatch",
    );
    expect(calls).toBe(0);
    expect(replayed).toContainEqual({
      kind: "message",
      id: "partial",
      text: "Partial reply",
      replace: true,
    });
  } finally {
    await connection.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);

test("closing an unresponsive fx prompt closes its backend before joining durable tasks", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-acp-close-"));
  let started!: () => void;
  let rejectPrompt!: (error: Error) => void;
  let closed = false;
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  const backend: AgentHarnessAdapter = {
    id: "fx",
    label: "fx",
    connect() {
      return {
        start: async () => "native-session",
        prompt: async () => {
          started();

          return new Promise((_, reject) => {
            rejectPrompt = reject;
          });
        },
        cancel() {},
        permission() {},
        close() {
          closed = true;
          rejectPrompt?.(new Error("Backend closed"));
        },
      };
    },
  };
  const connection = createThreadHarness({ home, backend }).connect({
    cwd: home,
    onEvent() {},
    onExit() {},
  });

  try {
    await connection.start();
    const pending = connection.prompt("Wait forever", "close-request").catch(() => undefined);

    await running;
    await connection.close();
    await pending;
    expect(closed).toBe(true);
  } finally {
    await connection.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 5000);
