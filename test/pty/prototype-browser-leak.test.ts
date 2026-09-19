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

/**
 * Force-kill a warm Chrome and every helper it spawned. Puppeteer launches
 * Chrome detached as its own process-group leader, so the negative-pid signal
 * reaps the whole group; the direct pid kill is the fallback for a platform
 * where Chrome is not a group leader. Both swallow ESRCH - the group may
 * already be gone. Guarantees the leak this suite guards against cannot escape
 * the test itself, whatever the quit path under test does.
 */
function killChromeTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // not a group leader, or the group is already gone
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
}

/** Read the fixture's first stdout line, or "" when it closes or the deadline passes. */
async function readFirstLine(
  proc: Bun.Subprocess<"pipe", "pipe", "inherit">,
  timeoutMs: number,
): Promise<string> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  const readLine = async (): Promise<string> => {
    let buffered = "";
    let line: string | null = null;

    while (line === null) {
      const { value, done } = await reader.read();

      if (done) {
        line = buffered.trim();
        break;
      }
      buffered += decoder.decode(value);
      const newlineAt = buffered.indexOf("\n");

      if (newlineAt !== -1) line = buffered.slice(0, newlineAt).trim();
    }

    return line;
  };

  try {
    return await Promise.race([readLine(), Bun.sleep(timeoutMs).then(() => "")]);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // a read is still pending after the deadline; the outer kill closes the stream
    }
  }
}

/**
 * Spawn the fixture, warm Chrome, run `quit`, and report whether the browser pid
 * died. Every wait is bounded and the teardown sits in finally, so a broken quit
 * path, a failed assertion, or a hang always reaps the fixture and its Chrome
 * tree within the test budget instead of orphaning them past it.
 */
async function browserPidAfterQuit(
  quit: (proc: Bun.Subprocess<"pipe", "pipe", "inherit">) => void,
): Promise<"no-chrome" | { dead: boolean; pid: number }> {
  const proc = Bun.spawn(["bun", FIXTURE], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  let browserPid: number | undefined;

  try {
    const line = await readFirstLine(proc, 20_000);

    if (line === "NOCHROME") {
      await Promise.race([proc.exited, Bun.sleep(2_000)]);

      return "no-chrome";
    }

    const pid = Number(line.replace("READY ", ""));

    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    browserPid = pid;

    quit(proc);
    await Promise.race([proc.exited, Bun.sleep(6_000)]);

    return { dead: await waitForDead(pid), pid };
  } finally {
    killChromeTree(browserPid);
    proc.kill("SIGKILL");
  }
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
