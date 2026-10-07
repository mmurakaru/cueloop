import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createPiHarness } from "./durable-harness";
import type { AgentHarnessEvent } from "@cueloop/schema";

const directories: string[] = [];

afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

test("Pi model failures preserve their reason instead of becoming an empty idle turn", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-pi-model-error-"));
  const models = createModels();
  const provider = fauxProvider();
  const failure = fauxAssistantMessage("");

  directories.push(home);
  failure.stopReason = "error";
  failure.errorMessage = "OAuth auth derivation failed: missing provider module";
  models.setProvider(provider.provider);
  provider.setResponses([failure]);
  const connection = createPiHarness({ home, models }).connect({
    cwd: home,
    onEvent() {},
    onExit() {},
  });

  try {
    await connection.start();
    await expect(connection.prompt("Hello", "failed-request")).rejects.toThrow(
      failure.errorMessage,
    );
  } finally {
    await connection.close();
  }
});

test("standalone Pi harness bundles Codex OAuth credential derivation", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-pi-compiled-oauth-"));
  const script = join(home, "oauth-worker.ts");
  const binary = join(home, "oauth-worker");

  directories.push(home);
  writeFileSync(
    script,
    `
import { createPiHarness } from ${JSON.stringify(import.meta.dir + "/durable-harness.ts")};
import { builtinModels } from ${JSON.stringify(Bun.resolveSync("@earendil-works/pi-ai/providers/all", import.meta.dir))};
const models = builtinModels({ credentials: {
  read: async () => ({type:"oauth",access:"fixture-access",refresh:"fixture-refresh",expires:Date.now()+3600000}),
  list: async () => [{providerId:"openai-codex",type:"oauth"}],
  modify: async () => {throw new Error("Unexpected token refresh");},
  delete: async () => {},
}});
createPiHarness({home:${JSON.stringify(home)},models});
const auth = await models.getAuth("openai-codex");
if (auth?.auth.apiKey !== "fixture-access") throw new Error("Codex OAuth did not resolve");
console.log("Codex OAuth resolved");
`,
  );
  const build = Bun.spawn(
    [
      process.execPath,
      "build",
      "--compile",
      "--bytecode",
      "--format=esm",
      "--minify",
      script,
      "--outfile",
      binary,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const buildOutput = new Response(build.stderr).text();

  expect(await build.exited, await buildOutput).toBe(0);
  const worker = Bun.spawn([binary], { cwd: home, stdout: "pipe", stderr: "pipe" });
  const stdout = new Response(worker.stdout).text();
  const stderr = new Response(worker.stderr).text();

  expect(await worker.exited, await stderr).toBe(0);
  expect(await stdout).toContain("Codex OAuth resolved");
}, 60_000);

test("unsafe saved conversation IDs cannot open or erase the owner home", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-pi-unsafe-id-"));
  const sentinel = join(home, "model-credentials.json");
  const adapter = createPiHarness({ home, models: createModels() });

  directories.push(home);
  writeFileSync(sentinel, "owner credentials");
  for (const sessionId of ["", ".", ".."]) {
    await expect(adapter.remove!(sessionId)).rejects.toThrow("Unsafe Pi conversation ID");
    const connection = adapter.connect({ cwd: home, sessionId, onEvent() {}, onExit() {} });

    await expect(connection.start()).rejects.toThrow("Unsafe Pi conversation ID");
    await connection.close();
    expect(existsSync(sentinel)).toBe(true);
  }
});

test("Pi conversation survives reopen and deduplicates the same admitted input", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-pi-harness-"));
  const models = createModels();
  const provider = fauxProvider();
  const events: AgentHarnessEvent[] = [];

  directories.push(home);
  models.setProvider(provider.provider);
  provider.setResponses([
    fauxAssistantMessage("First answer"),
    (context) => {
      expect(JSON.stringify(context.messages)).toContain("First question");

      return fauxAssistantMessage("Second answer");
    },
  ]);
  const adapter = createPiHarness({ home, models });
  const options = {
    cwd: home,
    onEvent: (event: AgentHarnessEvent) => events.push(event),
    onExit: () => {},
  };
  const first = adapter.connect(options);
  const sessionId = await first.start();

  expect(await first.prompt("First question", "request-1")).toEqual({ outcome: "completed" });
  await first.close();
  const second = adapter.connect({ ...options, sessionId });

  expect(await second.start()).toBe(sessionId);
  expect(await second.prompt("First question", "request-1")).toEqual({ outcome: "completed" });
  expect(provider.state.callCount).toBe(1);
  expect(await second.prompt("Second question", "request-2")).toEqual({ outcome: "completed" });
  expect(provider.state.callCount).toBe(2);
  expect(events.some((event) => event.kind === "message" && event.text.includes("Second"))).toBe(
    true,
  );
  await second.close();
});

test("closing during storage initialization waits and releases the writer without publishing configuration", async () => {
  const { openNodeJsonlStorage } = await import("@earendil-works/pi-durable/storage/jsonl/node");
  const home = mkdtempSync(join(tmpdir(), "cueloop-pi-start-close-"));
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const events: AgentHarnessEvent[] = [];
  const connection = createPiHarness({
    home,
    models: createModels(),
    storage: async (_id, context) => {
      ready.resolve();
      await release.promise;

      return openNodeJsonlStorage(join(home, "conversation"), context);
    },
  }).connect({ cwd: home, onEvent: (event) => events.push(event), onExit: () => {} });

  directories.push(home);
  const starting = connection.start();
  const rejected = starting.catch((error: Error) => error);

  await ready.promise;
  const closing = connection.close();

  release.resolve();
  await closing;
  expect(await rejected).toMatchObject({ message: "Pi conversation is closed" });
  expect(events).toEqual([]);
  const context = { abortSignal: undefined, value: () => undefined, toString: () => "test" };
  const reopened = await openNodeJsonlStorage(join(home, "conversation"), context);

  await reopened.close(context);
});

test("removing a Pi conversation erases its durable input receipts and transcript", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-pi-delete-"));
  const models = createModels();
  const provider = fauxProvider();

  directories.push(home);
  models.setProvider(provider.provider);
  provider.setResponses([fauxAssistantMessage("Old answer"), fauxAssistantMessage("Fresh answer")]);
  const adapter = createPiHarness({ home, models });
  const options = { cwd: home, onEvent: () => {}, onExit: () => {} };
  const first = adapter.connect(options);
  const sessionId = await first.start();

  await first.prompt("Private question", "same-request");
  await first.close();
  await adapter.remove!(sessionId);
  const second = adapter.connect({ ...options, sessionId });

  await second.start();
  await second.prompt("Fresh question", "same-request");
  expect(provider.state.callCount).toBe(2);
  await second.close();
});

test("replaying an answered input still projects its answer after the active context resets", async () => {
  const { Harness, createRegistry } = await import("@earendil-works/pi-durable");
  const { openNodeJsonlStorage } = await import("@earendil-works/pi-durable/storage/jsonl/node");
  const home = mkdtempSync(join(tmpdir(), "cueloop-pi-reset-"));
  const models = createModels();
  const provider = fauxProvider();
  const events: AgentHarnessEvent[] = [];
  const context = { abortSignal: undefined, value: () => undefined, toString: () => "test" };

  directories.push(home);
  models.setProvider(provider.provider);
  provider.setResponses([fauxAssistantMessage("Durable answer")]);
  const adapter = createPiHarness({ home, models });
  const options = {
    cwd: home,
    onEvent: (event: AgentHarnessEvent) => events.push(event),
    onExit: () => {},
  };
  const first = adapter.connect(options);
  const sessionId = await first.start();

  await first.prompt("Original question", "original-request");
  await first.close();
  const harness = await Harness.open(
    await openNodeJsonlStorage(join(home, "pi-conversations", sessionId), context),
    { models, registry: createRegistry() },
    context,
  );
  const root = await harness.root(context);

  await root.reset(undefined, context);
  await root.waitForIdle(context);
  expect(
    (await root.context(context)).entries.some((entry) =>
      entry.model?.some((message) => message.role === "user"),
    ),
  ).toBe(false);
  await harness.close(context);
  events.length = 0;
  const second = adapter.connect({ ...options, sessionId });

  await second.start();
  await second.prompt("Original question", "original-request");
  expect(provider.state.callCount).toBe(1);
  expect(events.filter((event) => event.kind === "message").at(-1)).toMatchObject({
    text: "Durable answer",
  });
  await second.close();
});

test("an interrupted Pi generation resumes the same durable request after process restart", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-pi-crash-"));
  const script = join(home, "worker.ts");
  const ready = join(home, "ready");
  const adapterPath = import.meta.dir + "/durable-harness.ts";
  const modelsPath = import.meta.resolve("@earendil-works/pi-ai");

  directories.push(home);
  writeFileSync(
    script,
    `import { createPiHarness } from ${JSON.stringify(adapterPath)};
import { createModels, fauxProvider } from ${JSON.stringify(modelsPath)};
const models = createModels(); const provider = fauxProvider(); models.setProvider(provider.provider);
provider.setResponses([async () => { await Bun.write(${JSON.stringify(ready)}, "ready"); return new Promise(() => {}); }]);
const connection = createPiHarness({ home: ${JSON.stringify(home)}, models }).connect({ cwd: ${JSON.stringify(home)}, sessionId: "crash-session", onEvent() {}, onExit() {} });
await connection.start(); await connection.prompt("Recover this input", "durable-request");`,
  );
  const child = Bun.spawn([process.execPath, script], { stdout: "ignore", stderr: "pipe" });
  const stderr = new Response(child.stderr).text();

  try {
    for (let attempt = 0; !existsSync(ready) && attempt < 200; attempt++) await Bun.sleep(5);
    expect(existsSync(ready)).toBe(true);
    child.kill("SIGKILL");
    await child.exited;
    expect(await stderr).toBe("");
    const models = createModels();
    const provider = fauxProvider();
    const events: AgentHarnessEvent[] = [];

    models.setProvider(provider.provider);
    provider.setResponses([fauxAssistantMessage("Recovered answer")]);
    const connection = createPiHarness({ home, models }).connect({
      cwd: home,
      sessionId: "crash-session",
      onEvent: (event) => events.push(event),
      onExit() {},
    });

    await connection.start();
    expect(await connection.prompt("Recover this input", "durable-request")).toEqual({
      outcome: "completed",
    });
    expect(provider.state.callCount).toBe(1);
    expect(events.filter((event) => event.kind === "message").at(-1)).toMatchObject({
      text: "Recovered answer",
    });
    await connection.close();
  } finally {
    child.kill();
    await child.exited;
  }
});
