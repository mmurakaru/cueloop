import { expect, test, describe, afterAll } from "bun:test";
import * as v from "valibot";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentHarnessEvent } from "@cueloop/schema";
import { createFxHarness } from "../fx/harness";
import { createThreadHarness } from "../thread-harness";
import { HerdrRelayClient } from "./client";
import { detectHc } from "./detect";
import { resolveHerdrAcp, type HerdrAcpIntegration } from "./index";
import {
  hcVersionAtLeast,
  herdrSessionName,
  herdrSocketPath,
  herdrTranscriptPath,
  parseHcVersion,
} from "./names";
import { recordsAfter } from "./relay";
import { answeredRequestSequences, foldRecords, promptStillOpen } from "./scan";

const standIn = fileURLToPath(new URL("./stand-in.ts", import.meta.url));

function toolRequest(sequence: number, id: number) {
  return {
    sequence,
    direction: "out" as const,
    line: JSON.stringify({ jsonrpc: "2.0", id, method: "mcp/message" }),
  };
}

function toolResponse(sequence: number, id: number) {
  return {
    sequence,
    direction: "in" as const,
    line: JSON.stringify({ jsonrpc: "2.0", id, result: { ok: true } }),
  };
}
const SavedRunSchema = v.object({
  result: v.object({ outcome: v.string() }),
  events: v.array(v.object({ kind: v.string(), text: v.optional(v.string()) })),
});

test("herdr session uses HC_SESSION and otherwise stays on its own session", () => {
  expect(herdrSessionName({})).toBe("cueloop");
  expect(herdrSessionName({ HC_SESSION: "desk" })).toBe("desk");
  expect(herdrSessionName({ HC_SESSION: "desk" }, "override")).toBe("override");
  expect(herdrSessionName({ HC_SESSION: "   " })).toBe("cueloop");
});

test("acknowledged transcript lines are not kept for replay", () => {
  const records = [
    { sequence: 1, direction: "out" as const, line: "a" },
    { sequence: 2, direction: "in" as const, line: "b" },
    { sequence: 3, direction: "out" as const, line: "c" },
  ];

  expect(recordsAfter(records, 0).map((record) => record.sequence)).toEqual([1, 2, 3]);
  expect(recordsAfter(records, 2).map((record) => record.sequence)).toEqual([3]);
  expect(recordsAfter(records, 3)).toEqual([]);
});

test("an answered tool request is not replayed and an open one is", () => {
  const answered = answeredRequestSequences([
    toolRequest(1, 7),
    toolResponse(2, 7),
    toolRequest(3, 7),
  ]);

  expect([...answered]).toEqual([1]);
});

test("a stop reason at the checkpoint belongs to the previous turn", () => {
  expect(promptStillOpen(null, 4)).toBe(false);
  expect(promptStillOpen({ id: 4, stopReason: "end_turn", answeredAt: 4 }, 4)).toBe(false);
  expect(promptStillOpen({ id: 5, stopReason: null, answeredAt: null }, 4)).toBe(true);
  expect(promptStillOpen({ id: 5, stopReason: "end_turn", answeredAt: 9 }, 4)).toBe(true);
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
    {
      sequence: 1,
      direction: "in",
      line: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    },
    {
      sequence: 2,
      direction: "out",
      line: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: 1, agentCapabilities: { loadSession: true } },
      }),
    },
    {
      sequence: 3,
      direction: "in",
      line: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: {} }),
    },
    {
      sequence: 4,
      direction: "out",
      line: JSON.stringify({ jsonrpc: "2.0", id: 2, result: { sessionId: "sess-1" } }),
    },
    {
      sequence: 5,
      direction: "in",
      line: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "session/prompt",
        params: { prompt: [{ text: "hold" }] },
      }),
    },
  ]);

  expect(scan.sessionId).toBe("sess-1");
  expect(scan.prompt).toEqual({ id: 4, stopReason: null, answeredAt: null });
  expect(scan.cursor).toBe(4);
  expect(
    foldRecords([
      {
        sequence: 5,
        direction: "in",
        line: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "session/prompt" }),
      },
      {
        sequence: 6,
        direction: "out",
        line: JSON.stringify({ jsonrpc: "2.0", id: 4, result: { stopReason: "end_turn" } }),
      },
    ]).prompt,
  ).toEqual({ id: 4, stopReason: "end_turn", answeredAt: 6 });
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

test("an idle relay exits after its client disconnects", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-herdr-idle-"));
  const integration = resolveHerdrAcp({
    enabled: true,
    launch: "process",
    home,
    command: [process.execPath, standIn],
    env: { ...process.env, HERDR_ACP_IDLE_MS: "200" },
  });

  if (!integration) throw new Error("process launch should not need hc");

  try {
    await integration.prepare("idle-1", home);
    const client = new HerdrRelayClient();

    await client.connect(herdrSocketPath(home, "idle-1"));
    const state = await client.attach();

    client.close();
    expect(await waitForExit(state.pid)).toBe(true);
  } finally {
    await integration.remove("idle-1").catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
  }
});

test("a finished session accepts another prompt after the daemon restarts", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-herdr-next-"));
  const first = resolveHerdrAcp({
    enabled: true,
    launch: "process",
    home,
    command: [process.execPath, standIn],
    env: process.env,
  });

  if (!first) throw new Error("process launch should not need hc");

  try {
    const opened = harnessWith(home, first).connect({
      cwd: home,
      sessionId: "next-1",
      onEvent() {},
      onExit() {},
    });

    await opened.start();
    expect(await opened.prompt("first turn", "next-a")).toEqual({ outcome: "completed" });
    await opened.close();
    const second = resolveHerdrAcp({
      enabled: true,
      launch: "process",
      home,
      command: [process.execPath, standIn],
      env: process.env,
    });

    if (!second) throw new Error("process launch should not need hc");

    const events: AgentHarnessEvent[] = [];
    const reopened = harnessWith(home, second).connect({
      cwd: home,
      sessionId: "next-1",
      onEvent: (event) => events.push(event),
      onExit() {},
    });

    await reopened.start();
    expect(await reopened.prompt("second turn", "next-b")).toEqual({ outcome: "completed" });
    expect(
      events.some((event) => event.kind === "message" && event.text.includes("second turn")),
    ).toBe(true);
    await reopened.close();
    await second.remove("next-1");
  } finally {
    await shutdownSocket(join(home, "herdr-acp"));
    rmSync(home, { recursive: true, force: true });
  }
});

test("a killed relay fails the prompt instead of waiting", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-herdr-die-"));
  const hold = join(home, "hold");
  const integration = resolveHerdrAcp({
    enabled: true,
    launch: "process",
    home,
    command: [process.execPath, standIn],
    env: { ...process.env, HERDR_ACP_HOLD_FILE: hold },
  });

  writeFileSync(hold, "");

  if (!integration) throw new Error("process launch should not need hc");

  try {
    const opened = harnessWith(home, integration).connect({
      cwd: home,
      sessionId: "die-1",
      onEvent() {},
      onExit() {},
    });

    await opened.start();
    const pending = opened.prompt("please hold this turn", "die-request");

    expect(await waitForFile(hold, "waiting")).toBe(true);
    const pid = processWithArg(herdrSocketPath(home, "die-1"));

    if (pid === undefined) throw new Error("relay pid missing");

    process.kill(pid, "SIGKILL");
    await expect(pending).rejects.toThrow(/exited|disconnected/);
  } finally {
    killByMarker(hold);
    await shutdownSocket(join(home, "herdr-acp")).catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
  }
}, 15_000);

test("deleting a thread stops a relay the daemon has not attached", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-herdr-gone-"));
  const started = resolveHerdrAcp({
    enabled: true,
    launch: "process",
    home,
    command: [process.execPath, standIn],
    env: process.env,
  });

  if (!started) throw new Error("process launch should not need hc");

  try {
    await started.prepare("gone-1", home);
    const pid = processWithArg(herdrSocketPath(home, "gone-1"));
    const restarted = resolveHerdrAcp({
      enabled: true,
      launch: "process",
      home,
      command: [process.execPath, standIn],
      env: process.env,
    });

    if (!restarted) throw new Error("process launch should not need hc");

    if (pid === undefined) throw new Error("relay pid missing");

    await restarted.remove("gone-1");
    expect(await waitForExit(pid)).toBe(true);
    expect(existsSync(herdrTranscriptPath(home, "gone-1"))).toBe(false);
  } finally {
    await shutdownSocket(join(home, "herdr-acp")).catch(() => undefined);
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
    expect(statSync(herdrTranscriptPath(home, "run-1")).mode & 0o777).toBe(0o600);
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

describe.skipIf(!hc)("a real hc terminal", () => {
  let home = "";
  let runtime = "";
  let state = "";
  let config = "";
  const session = `cueloop-test-${process.pid}`;
  const isolated = () => ({
    ...process.env,
    HC_SESSION: session,
    XDG_RUNTIME_DIR: runtime,
    XDG_STATE_HOME: state,
    XDG_CONFIG_HOME: config,
    CUELOOP_HC: hc?.binary,
  });

  afterAll(() => {
    if (!hc || !home) return;

    spawnSync(hc.binary, ["server", "stop"], { env: isolated(), timeout: 8_000 });
    stopHerdrProcesses(session, state);
    rmSync(home, { recursive: true, force: true });
  });

  test("keeps the prompt alive across SIGKILL without touching the user state directory", async () => {
    if (!hc) throw new Error("hc was not detected");

    home = mkdtempSync(join(tmpdir(), "cueloop-herdr-hc-"));
    runtime = join(home, "runtime");
    state = join(home, "state");
    config = join(home, "config");
    const hold = join(home, "hold");
    const count = join(home, "count");
    const ready = join(home, "ready");
    const done = join(home, "done");
    const worker = join(home, "worker.ts");

    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    mkdirSync(state, { recursive: true, mode: 0o700 });
    mkdirSync(config, { recursive: true, mode: 0o700 });
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
  hcSession: ${JSON.stringify(session)},
  xdgRuntimeDir: ${JSON.stringify(runtime)},
  xdgStateHome: ${JSON.stringify(state)},
  xdgConfigHome: ${JSON.stringify(config)},
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
      ...isolated(),
      HERDR_ACP_HOLD_FILE: hold,
      HERDR_ACP_COUNT_FILE: count,
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
    }
  }, 30_000);
});

function stopHerdrProcesses(session: string, stateDir: string): void {
  let pids: string[] = [];

  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return;
  }

  for (const pid of pids) {
    let marker = "";

    try {
      marker = readFileSync(`/proc/${pid}/environ`).toString();
    } catch {
      continue;
    }

    if (!marker.includes(`HC_SESSION=${session}`) && !marker.includes(stateDir)) continue;

    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // The process already exited.
    }
  }
}

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

function processWithArg(text: string): number | undefined {
  let pids: string[] = [];

  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return undefined;
  }

  for (const pid of pids) {
    let command = "";

    try {
      command = readFileSync(`/proc/${pid}/cmdline`).toString();
    } catch {
      continue;
    }

    if (command.includes(text)) return Number(pid);
  }

  return undefined;
}

function killByMarker(marker: string): void {
  let pids: string[] = [];

  try {
    pids = readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return;
  }

  for (const pid of pids) {
    let text = "";

    try {
      text = readFileSync(`/proc/${pid}/environ`).toString();
    } catch {
      continue;
    }

    if (!text.includes(marker)) continue;

    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // The process already exited.
    }
  }
}

function waitForExit(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      try {
        process.kill(pid, 0);
      } catch {
        clearInterval(timer);
        clearTimeout(timeout);
        resolve(true);
      }
    }, 30);
    const timeout = setTimeout(() => {
      clearInterval(timer);
      resolve(false);
    }, 3_000);
  });
}

function waitForFile(
  path: string,
  text: string,
  child?: { exited: Promise<number>; stderr: ReadableStream },
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;

      settled = true;
      clearInterval(timer);
      clearTimeout(timeout);
      resolve(value);
    };
    const timer = setInterval(() => {
      try {
        if (readFileSync(path, "utf8").includes(text)) finish(true);
      } catch {
        // The file is created by the child.
      }
    }, 30);
    const timeout = setTimeout(() => finish(false), 10_000);

    if (!child) return;

    void child.exited.then((code) => {
      if (settled) return;

      settled = true;
      clearInterval(timer);
      clearTimeout(timeout);
      void new Response(child.stderr).text().then((stderr) => {
        reject(new Error(`child exited ${code} before ${path} contained ${text}\n${stderr}`));
      });
    });
  });
}

async function shutdownSocket(directory: string): Promise<void> {
  let names: string[] = [];

  try {
    names = readdirSync(directory);
  } catch {
    return;
  }

  const sockets = names.filter((name) => name.endsWith(".sock"));

  await Promise.all(
    sockets.map(async (name) => {
      const client = new HerdrRelayClient();

      try {
        await client.connect(join(directory, name));
        client.shutdown();
      } catch {
        // The relay is already gone.
      }
    }),
  );
}
