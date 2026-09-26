import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonServer } from "@cueloop/daemon";
import { DaemonClient } from "@cueloop/daemon/client";
import { createCodexSessionRegistry } from "@cueloop/adapters/codex/session-registry";
import { runHarnessBridge } from "@cueloop/adapters/harness-bridge";
import { startCodexDeliveryWorker } from "./codex-delivery-worker-command";

const home = mkdtempSync(join(tmpdir(), "cueloop-codex-worker-"));
const server = new DaemonServer({ home, idleExitMs: 0 });
const codexBin = join(home, "codex");
let worker: ReturnType<typeof Bun.spawn> | undefined;

afterEach(async () => {
  worker?.kill();
  await worker?.exited;
  server.stop();
  rmSync(home, { recursive: true, force: true });
});

test("a Codex reply is delivered without an MCP transport", async () => {
  server.start();
  writeFileSync(codexBin, '#!/bin/sh\nprintf "%s" "$5" > delivered.txt\n');
  chmodSync(codexBin, 0o755);
  createCodexSessionRegistry(home).activate("codex-session-1");
  const opened = await runHarnessBridge(
    {
      operation: "open",
      harness: "codex",
      harnessSessionId: "codex-session-1",
      cwd: home,
      workflow: "plan",
      content: "# Wait for feedback",
    },
    home,
  );

  if (opened.operation !== "open") throw new Error("expected open Thread");
  const previousCodexBin = process.env.CUELOOP_CODEX_BIN;

  // A reused PID belonging to this test process must not impersonate the worker.
  writeFileSync(join(home, "codex-delivery-worker.pid"), String(process.pid));
  process.env.CUELOOP_CODEX_BIN = codexBin;
  worker = startCodexDeliveryWorker(home, [
    process.execPath,
    "run",
    import.meta.dir + "/main.ts",
    "codex-delivery-worker",
  ]);
  if (previousCodexBin === undefined) delete process.env.CUELOOP_CODEX_BIN;
  else process.env.CUELOOP_CODEX_BIN = previousCodexBin;
  expect(worker).toBeDefined();
  const deadline = Date.now() + 5000;

  while (!existsSync(join(home, "codex-delivery-worker.pid")) && Date.now() < deadline)
    await Bun.sleep(20);
  expect(existsSync(join(home, "codex-delivery-worker.pid"))).toBe(true);
  const client = await DaemonClient.connect({ home });

  try {
    await client.sessionSendMessage(opened.threadId, "approved", "Continue after MCP exit.");
    while (!existsSync(join(home, "delivered.txt")) && Date.now() < deadline) await Bun.sleep(20);
    expect(readFileSync(join(home, "delivered.txt"), "utf8")).toContain("Continue after MCP exit.");
  } finally {
    client.close();
  }
});
