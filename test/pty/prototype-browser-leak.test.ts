/**
 * Leak regression: the prototype Chromium must not orphan when cueloop quits.
 * A fixture warms a real headless Chrome and mirrors run.ts's shutdown wiring;
 * this drives it through each quit path (q, SIGTERM, SIGHUP) and asserts the
 * browser process is gone afterward. Env-gated behind CUELOOP_RUN_PTY - it
 * launches real Chrome, so it never runs in the plain unit suite.
 */

import { describe, expect } from "bun:test";
import { join } from "node:path";
import { PTY_TIER_ENABLED, ptyTest } from "../helpers/pty-reviews";

const FIXTURE = join(import.meta.dir, "fixtures", "prototype-shutdown.ts");

/** Wait until `pid` is gone (a dead pid makes kill(pid, 0) throw), or time out. */
async function waitForDead(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await Bun.sleep(100);
  }

  return false;
}

/** Spawn the fixture, warm Chrome, run `quit`, and report whether the browser pid died. */
async function browserPidAfterQuit(
  quit: (proc: Bun.Subprocess<"pipe", "pipe", "inherit">) => void,
): Promise<"no-chrome" | { dead: boolean; pid: number }> {
  const proc = Bun.spawn(["bun", FIXTURE], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let line = "";

  while (!line) {
    const { value, done } = await reader.read();

    if (done) break;
    buffered += decoder.decode(value);
    const newlineAt = buffered.indexOf("\n");

    if (newlineAt !== -1) line = buffered.slice(0, newlineAt).trim();
  }
  reader.releaseLock();

  if (line === "NOCHROME") {
    await proc.exited;

    return "no-chrome";
  }

  const pid = Number(line.replace("READY ", ""));

  expect(Number.isInteger(pid) && pid > 0).toBe(true);

  quit(proc);
  await proc.exited;
  const dead = await waitForDead(pid);

  if (!dead) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone between the check and the cleanup kill
    }
  }

  return { dead, pid };
}

describe("prototype browser leak", () => {
  ptyTest(
    "q exit closes the warm Chromium",
    async () => {
      const result = await browserPidAfterQuit((proc) => {
        proc.stdin.write("q");
        proc.stdin.end();
      });

      if (result === "no-chrome") return;
      expect(result.dead).toBe(true);
    },
    30_000,
  );

  ptyTest(
    "SIGTERM closes the warm Chromium",
    async () => {
      const result = await browserPidAfterQuit((proc) => proc.kill("SIGTERM"));

      if (result === "no-chrome") return;
      expect(result.dead).toBe(true);
    },
    30_000,
  );

  ptyTest(
    "SIGHUP closes the warm Chromium",
    async () => {
      const result = await browserPidAfterQuit((proc) => proc.kill("SIGHUP"));

      if (result === "no-chrome") return;
      expect(result.dead).toBe(true);
    },
    30_000,
  );
});

// keep the import used even when the tier is off, so the file type-checks cleanly
void PTY_TIER_ENABLED;
