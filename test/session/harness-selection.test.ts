import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "@cueloop/daemon/client";
import { stopDaemon } from "../../packages/cli/src/daemon-control";

async function runTestHarnessCli(home: string, args: string[]) {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "../../packages/cli/src/main.ts"), ...args],
    {
      env: { ...process.env, CUELOOP_HOME: home, CUELOOP_CONFIG: join(home, "config.toml") },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { code, stdout, stderr };
}

test("CLI restart selects the live harness and launcher rejects a mismatched daemon", async () => {
  const home = mkdtempSync(join(tmpdir(), "cueloop-cli-harness-"));

  writeFileSync(
    join(home, "config.toml"),
    "[experimental]\nthread_agent = true\n[thread]\nharness = 'pi'\n",
  );
  try {
    const fx = await runTestHarnessCli(home, ["restart", "--harness", "fx"]);

    expect(fx.code, fx.stderr).toBe(0);
    const client = await DaemonClient.connect({ home });
    const first = await client.ping();

    client.close();
    expect(first.agentHarness).toBe("fx");
    const mismatch = await runTestHarnessCli(home, ["--harness", "pi", "plan", "missing-thread"]);

    expect(mismatch.code).toBe(1);
    expect(mismatch.stderr).toContain("restart --harness pi");
    const pi = await runTestHarnessCli(home, ["restart", "--harness=pi"]);

    expect(pi.code, pi.stderr).toBe(0);
    const restarted = await DaemonClient.connect({ home });

    try {
      const final = await restarted.ping();

      expect(final.agentHarness).toBe("pi");
      expect(final.pid).not.toBe(first.pid);
    } finally {
      restarted.close();
    }
  } finally {
    await stopDaemon(home);
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
