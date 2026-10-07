import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createModels, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { AgentHarnessAdapter, AgentHarnessEvent } from "@cueloop/schema";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
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
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
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

test("a failed fx attempt remains settled until an explicit new attempt is admitted", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-acp-retry-"));
  let calls = 0;
  const backend = createTestBackend(() => {
    calls++;

    if (calls === 1) throw new Error("Dispatch failed");
  });
  const connection = createThreadHarness({ home, backend }).connect({
    cwd: home,
    onEvent() {},
    onExit() {},
  });

  try {
    await connection.start();
    await expect(connection.prompt("Review", "attempt-one")).rejects.toThrow("Dispatch failed");
    await expect(connection.prompt("Review", "attempt-one")).rejects.toThrow("Dispatch failed");
    expect(calls).toBe(1);
    expect(await connection.prompt("Review", "attempt-two")).toEqual({ outcome: "completed" });
    expect(calls).toBe(2);
  } finally {
    await connection.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("cancelling during durable admission prevents ACP dispatch", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-cancel-admission-"));
  const calls: string[] = [];
  const connection = createThreadHarness({
    home,
    backend: createTestBackend((text) => calls.push(text)),
  }).connect({ cwd: home, onEvent() {}, onExit() {} });

  try {
    await connection.start();
    const pending = connection.prompt("Do not dispatch", "cancel-admission");

    connection.cancel();
    expect(await pending).toEqual({ outcome: "cancelled" });
    expect(calls).toEqual([]);
    expect(await connection.prompt("Continue", "after-cancel")).toEqual({ outcome: "completed" });
    expect(calls).toEqual(["Continue"]);
  } finally {
    await connection.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("cancelling while the dispatch checkpoint is committing prevents native execution", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-cancel-dispatch-"));
  const calls: string[] = [];
  const checkpoint = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const connection = createThreadHarness({
    home,
    backend: createTestBackend((text) => calls.push(text)),
    async storage(sessionId, context) {
      const storage = await openNodeJsonlStorage(join(home, sessionId), context);
      const commit = storage.commit.bind(storage);

      storage.commit = async (writes, context) => {
        if (
          writes.some(
            (write) =>
              write.type === "task" &&
              write.value.state.status === "running" &&
              JSON.stringify(write.value.state.checkpoint) === '{"phase":"dispatched"}',
          )
        ) {
          checkpoint.resolve();
          await release.promise;
        }

        return commit(writes, context);
      };

      return storage;
    },
  }).connect({ cwd: home, onEvent() {}, onExit() {} });

  try {
    await connection.start();
    const pending = connection.prompt("Do not dispatch", "cancel-checkpoint");

    await checkpoint.promise;
    connection.cancel();
    release.resolve();
    expect(await pending).toEqual({ outcome: "cancelled" });
    expect(calls).toEqual([]);
  } finally {
    release.resolve();
    await connection.close();
    rmSync(home, { recursive: true, force: true });
  }
});
