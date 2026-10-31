import { expect, test } from "bun:test";
import * as v from "valibot";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentHarnessEvent } from "@cueloop/schema";
import { createFxHarness } from "../fx/harness";
import { createThreadHarness } from "../thread-harness";
import { HerdrRelayClient } from "./client";
import { detectHc } from "./detect";
import { resolveHerdrAcp, type HerdrAcpIntegration } from "./index";
import { hcVersionAtLeast, parseHcVersion } from "./names";
import { foldRecords } from "./scan";

const standIn = fileURLToPath(new URL("./stand-in.ts", import.meta.url));
const SavedRunSchema = v.object({
  result: v.object({ outcome: v.string() }),
  events: v.array(v.object({ kind: v.string(), text: v.optional(v.string()) })),
});

test("hc versions compare numerically and reject text that is not a release", () => {
  expect(parseHcVersion("hc 0.1.15\n")).toEqual([0, 1, 15]);
  expect(hcVersionAtLeast([0, 1, 15], [0, 1, 15])).toBe(true);
  expect(hcVersionAtLeast([0, 1, 14], [0, 1, 15])).toBe(false);
  expect(hcVersionAtLeast([0, 2, 0], [0, 1, 15])).toBe(true);
  expect(parseHcVersion("no version")).toBeUndefined();
});

test("transcript fold keeps the session, the in-flight prompt, and its stop reason", () => {
  const scan = foldRecords([
    { seq: 1, dir: "in", line: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) },
    {
      seq: 2,
      dir: "out",
      line: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
      }),
    },
    {
      seq: 3,
      dir: "in",
      line: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: {} }),
    },
    {
      seq: 4,
      dir: "out",
      line: JSON.stringify({ jsonrpc: "2.0", id: 2, result: { sessionId: "sess-1" } }),
    },
    {
      seq: 5,
      dir: "in",
      line: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "session/prompt",
        params: { prompt: [{ text: "hold" }] },
      }),
    },
  ]);

  expect(scan.sessionId).toBe("sess-1");
  expect(scan.prompt).toEqual({ id: 4, stopReason: null });
  expect(scan.cursor).toBe(4);
  expect(
    foldRecords([
      {
        seq: 5,
        dir: "in",
        line: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "session/prompt" }),
      },
      {
        seq: 6,
        dir: "out",
        line: JSON.stringify({ jsonrpc: "2.0", id: 4, result: { stopReason: "end_turn" } }),
      },
    ]).prompt,
  ).toEqual({ id: 4, stopReason: "end_turn" });
});

test("the herdr flag off does not look for hc", () => {
  let detected = false;
  const integration = resolveHerdrAcp({
    enabled: false,
    home: "/tmp/unused",
    command: ["fx", "acp"],
    detect: () => {
      detected = true;

      return { binary: "hc", version: "0.1.15" };
    },
  });

  expect(integration).toBeUndefined();
  expect(detected).toBe(false);
});

test("a missing hc falls back without a backend", () => {
  const warnings: string[] = [];
  const integration = resolveHerdrAcp({
    enabled: true,
    home: "/tmp/unused",
    command: ["fx", "acp"],
    detect: () => undefined,
    warn: (message) => warnings.push(message),
  });

  expect(integration).toBeUndefined();
  expect(warnings.join("\n")).toContain("not installed");
  const empty = mkdtempSync(join(tmpdir(), "cueloop-no-hc-"));

  try {
    expect(detectHc({ ...process.env, PATH: empty, CUELOOP_HC: "" })).toBeUndefined();
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("an fx dispatch without herdr recovery still fails closed after a restart", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-herdr-off-"));
  const workerPath = join(home, "worker.ts");

  writeFileSync(
    workerPath,
    `
import { createThreadHarness } from ${JSON.stringify(join(import.meta.dir, "../thread-harness.ts"))};
const connection = createThreadHarness({home:${JSON.stringify(home)},backend:{id:"fx",label:"fx",connect(options){return {
start:async()=>"native-session",prompt:async()=>{options.onEvent({kind:"message",id:"partial",text:"Partial"});await new Promise(()=>{});},cancel(){},permission(){},close(){}
}}}}).connect({cwd:${JSON.stringify(home)},sessionId:"off",onEvent(event){if(event.kind==="message")process.exit(0);},onExit(){}});
await connection.start();
await connection.prompt("Unsafe external operation","off-request");
`,
  );
  const worker = Bun.spawn([process.execPath, workerPath], { stdout: "pipe", stderr: "pipe" });
  const stderr = new Response(worker.stderr).text();

  expect(await worker.exited, await stderr).toBe(0);
  let calls = 0;
  const connection = createThreadHarness({
    home,
    backend: {
      id: "fx",
      label: "fx",
      connect() {
        return {
          start: async () => "native-session",
          prompt: async () => {
            calls += 1;

            return { outcome: "completed" as const };
          },
          cancel() {},
          permission() {},
          close() {},
        };
      },
    },
  }).connect({ cwd: home, sessionId: "off", onEvent() {}, onExit() {} });

  try {
    await connection.start();
    await expect(connection.prompt("Unsafe external operation", "off-request")).rejects.toThrow(
      "interrupted after dispatch",
    );
    expect(calls).toBe(0);
  } finally {
    await connection.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("a herdr relay runs a prompt and finishes it", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-herdr-run-"));
  const count = join(home, "count");
  const events: AgentHarnessEvent[] = [];
  const integration = resolveHerdrAcp({
    enabled: true,
    launch: "process",
    home,
    command: [process.execPath, standIn],
    env: { ...process.env, HERDR_ACP_COUNT_FILE: count },
  });

  if (!integration) throw new Error("process launch should not need hc");

  const harness = harnessWith(home, integration);

  try {
    const opened = harness.connect({
      cwd: home,
      sessionId: "run-1",
      onEvent: (event) => events.push(event),
      onExit() {},
    });

    await opened.start();
    expect(await opened.prompt("Say hello", "run-request")).toEqual({ outcome: "completed" });
    expect(readFileSync(count, "utf8")).toBe("1");
    expect(
      events.some((event) => event.kind === "message" && event.text.includes("Say hello")),
    ).toBe(true);
    await opened.close();
  } finally {
    await integration.remove("run-1").catch(() => undefined);
    await shutdownSocket(join(home, "herdr-acp"));
    rmSync(home, { recursive: true, force: true });
  }
});

test("a herdr prompt reattaches after the daemon process exits", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-herdr-resume-"));
  const hold = join(home, "hold");
  const count = join(home, "count");
  const ready = join(home, "ready");
  const done = join(home, "done");
  const worker = join(home, "worker.ts");

  writeFileSync(hold, "");
  writeFileSync(
    worker,
    `
import { writeFileSync } from "node:fs";
import { createFxHarness } from ${JSON.stringify(join(import.meta.dir, "../fx/harness.ts"))};
import { createThreadHarness } from ${JSON.stringify(join(import.meta.dir, "../thread-harness.ts"))};
import { resolveHerdrAcp } from ${JSON.stringify(join(import.meta.dir, "./index.ts"))};
const integration = resolveHerdrAcp({
  enabled: true,
  launch: "process",
  home: ${JSON.stringify(home)},
  command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(standIn)}],
  env: { ...process.env, HERDR_ACP_HOLD_FILE: ${JSON.stringify(hold)}, HERDR_ACP_COUNT_FILE: ${JSON.stringify(count)} },
});
if (!integration) throw new Error("missing integration");
const events = [];
const connection = createThreadHarness({
  home: ${JSON.stringify(home)},
  prepareAcp: integration.prepare,
  createAcp: integration.createAcp,
  backend: createFxHarness({
    command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(standIn)}],
    openAcp: integration.openAcp,
    existingSession: integration.existingSession,
    recoverPrompt: integration.recoverPrompt,
  }),
}).connect({
  cwd: ${JSON.stringify(home)},
  sessionId: "resume-1",
  onEvent(event) { events.push(event); },
  onExit() {},
});
await connection.start();
if (process.env.HERDR_ROLE === "resume") writeFileSync(${JSON.stringify(ready)}, "1");
const result = await connection.prompt("please hold this turn", "hold-request");
writeFileSync(${JSON.stringify(done)}, JSON.stringify({ result, events }));
await connection.close();
process.exit(0);
`,
  );
  const first = Bun.spawn([process.execPath, worker], {
    env: {
      ...process.env,
      HERDR_ROLE: "start",
      HERDR_ACP_HOLD_FILE: hold,
      HERDR_ACP_COUNT_FILE: count,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    expect(await waitForFile(hold, "waiting", first)).toBe(true);
    first.kill("SIGKILL");
    await first.exited;
    const second = Bun.spawn([process.execPath, worker], {
      env: {
        ...process.env,
        HERDR_ROLE: "resume",
        HERDR_ACP_HOLD_FILE: hold,
        HERDR_ACP_COUNT_FILE: count,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = new Response(second.stderr).text();

    expect(await waitForFile(ready, "1", second)).toBe(true);
    writeFileSync(hold, "go");
    expect(await second.exited, await stderr).toBe(0);
    const saved = v.parse(SavedRunSchema, JSON.parse(readFileSync(done, "utf8")));

    expect(saved.result).toEqual({ outcome: "completed" });
    expect(readFileSync(count, "utf8")).toBe("1");
    expect(
      saved.events.some(
        (event) => event.kind === "message" && event.text?.includes("finished after restart"),
      ),
    ).toBe(true);
  } finally {
    await shutdownSocket(join(home, "herdr-acp"));
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

const hc = detectHc();

test.skipIf(!hc)(
  "a real hc terminal keeps the prompt alive across SIGKILL",
  async () => {
    if (!hc) throw new Error("hc was not detected");

    const home = mkdtempSync(join(tmpdir(), "cueloop-herdr-hc-"));
    const runtime = join(home, "runtime");
    const hold = join(home, "hold");
    const count = join(home, "count");
    const ready = join(home, "ready");
    const done = join(home, "done");
    const worker = join(home, "worker.ts");

    mkdirSync(runtime, { recursive: true });
    writeFileSync(hold, "");
    writeFileSync(
      worker,
      `
import { writeFileSync } from "node:fs";
import { createFxHarness } from ${JSON.stringify(join(import.meta.dir, "../fx/harness.ts"))};
import { createThreadHarness } from ${JSON.stringify(join(import.meta.dir, "../thread-harness.ts"))};
import { resolveHerdrAcp } from ${JSON.stringify(join(import.meta.dir, "./index.ts"))};
const integration = resolveHerdrAcp({
  enabled: true,
  home: ${JSON.stringify(home)},
  command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(standIn)}],
  env: process.env,
  hcSession: ${JSON.stringify(`cueloop-test-${process.pid}`)},
  xdgRuntimeDir: ${JSON.stringify(runtime)},
  detect: () => (${JSON.stringify(hc)}),
});
if (!integration) throw new Error("hc was not detected");
const events = [];
const connection = createThreadHarness({
  home: ${JSON.stringify(home)},
  prepareAcp: integration.prepare,
  createAcp: integration.createAcp,
  backend: createFxHarness({
    command: [${JSON.stringify(process.execPath)}, ${JSON.stringify(standIn)}],
    openAcp: integration.openAcp,
    existingSession: integration.existingSession,
    recoverPrompt: integration.recoverPrompt,
  }),
}).connect({
  cwd: ${JSON.stringify(home)},
  sessionId: "hc-1",
  onEvent(event) { events.push(event); },
  onExit() {},
});
await connection.start();
if (process.env.HERDR_ROLE === "resume") writeFileSync(${JSON.stringify(ready)}, "1");
const result = await connection.prompt("please hold this turn", "hc-request");
writeFileSync(${JSON.stringify(done)}, JSON.stringify({ result, events }));
await connection.close();
process.exit(0);
`,
    );
    const env = {
      ...process.env,
      HERDR_ACP_HOLD_FILE: hold,
      HERDR_ACP_COUNT_FILE: count,
      CUELOOP_HC: hc.binary,
      XDG_RUNTIME_DIR: runtime,
    };
    const first = Bun.spawn([process.execPath, worker], {
      env: { ...env, HERDR_ROLE: "start" },
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      expect(await waitForFile(hold, "waiting", first)).toBe(true);
      first.kill("SIGKILL");
      await first.exited;
      const second = Bun.spawn([process.execPath, worker], {
        env: { ...env, HERDR_ROLE: "resume" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = new Response(second.stderr).text();

      expect(await waitForFile(ready, "1", second)).toBe(true);
      writeFileSync(hold, "go");
      expect(await second.exited, await stderr).toBe(0);
      expect(v.parse(SavedRunSchema, JSON.parse(readFileSync(done, "utf8"))).result).toEqual({
        outcome: "completed",
      });
      expect(readFileSync(count, "utf8")).toBe("1");
    } finally {
      await shutdownSocket(join(home, "herdr-acp"));
      rmSync(home, { recursive: true, force: true });
    }
  },
  30_000,
);

function harnessWith(home: string, integration: HerdrAcpIntegration) {
  return createThreadHarness({
    home,
    prepareAcp: integration.prepare,
    createAcp: integration.createAcp,
    onRemove: integration.remove,
    backend: createFxHarness({
      command: [process.execPath, standIn],
      openAcp: integration.openAcp,
      existingSession: integration.existingSession,
      recoverPrompt: integration.recoverPrompt,
    }),
  });
}

async function waitForFile(
  path: string,
  text: string,
  child?: { exited: Promise<number>; stderr: ReadableStream },
): Promise<boolean> {
  const started = Date.now();

  while (Date.now() - started < 10_000) {
    try {
      if (readFileSync(path, "utf8").includes(text)) return true;
    } catch {
      // The file is created by the child.
    }

    if (child) {
      const exited = await Promise.race([
        child.exited.then((code) => code),
        Bun.sleep(30).then(() => undefined),
      ]);

      if (exited !== undefined) {
        const stderr = await new Response(child.stderr).text();

        throw new Error(`child exited ${exited} before ${path} contained ${text}\n${stderr}`);
      }

      continue;
    }

    await Bun.sleep(30);
  }

  return false;
}

async function shutdownSocket(directory: string): Promise<void> {
  let names: string[] = [];

  try {
    names = readdirSync(directory);
  } catch {
    return;
  }

  for (const name of names) {
    if (!name.endsWith(".sock")) continue;

    const client = new HerdrRelayClient();

    try {
      await client.connect(join(directory, name));
      client.shutdown();
    } catch {
      // The relay is already gone.
    }
  }
}
