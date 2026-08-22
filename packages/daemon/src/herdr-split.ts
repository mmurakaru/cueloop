/**
 * Launches a bring-your-own review harness (claude code / pi / codex) in a herdr
 * split beside the current pane - the Agent rail's "run it right here" spawn, so
 * a reviewer chats with an agent about the plan without leaving the review tab.
 * Best-effort and herdr-only: a no-op returning false outside herdr or on any
 * spawn failure, each spawn bounded by a timeout.
 */

import { detectHerdr, type HerdrEnv } from "@cueloop/schema";

const HERDR_SPAWN_TIMEOUT_MS = 2000;

/** How much of the current pane the launched harness split takes (herdr --ratio). */
const HARNESS_SPLIT_RATIO = "0.4";

export interface LaunchHarnessInSplitOptions {
  /** The harness launch command run in the split, e.g. "cc", "pi", "codex". */
  command: string;
  /** Working directory for the split - the reviewed session's cwd. */
  cwd: string;
  /**
   * A plan-context briefing typed into the split after the harness command, left
   * unsubmitted for the reviewer to send. Best-effort: on a slow harness start it
   * may reach the shell instead, so the launch never depends on it.
   */
  seedText?: string;
}

/**
 * Split the current pane and run the harness in it. Returns true when the split
 * opened, false on any best-effort bail-out. No-op outside herdr.
 */
export function launchHarnessInSplit(
  options: LaunchHarnessInSplitOptions,
  env: HerdrEnv = process.env,
): boolean {
  const herdr = detectHerdr(env);
  if (!herdr) return false;
  try {
    const split = Bun.spawnSync(
      [
        herdr.binPath,
        "pane",
        "split",
        herdr.paneId,
        "--direction",
        "right",
        "--ratio",
        HARNESS_SPLIT_RATIO,
        "--cwd",
        options.cwd,
      ],
      { stdout: "pipe", stderr: "ignore", timeout: HERDR_SPAWN_TIMEOUT_MS },
    );
    if (split.exitCode !== 0) return false;
    const parsed = JSON.parse(split.stdout.toString()) as {
      result?: { pane?: { pane_id?: string } };
    };
    const paneId = parsed.result?.pane?.pane_id;
    if (!paneId) return false;
    sendText(herdr.binPath, paneId, options.command);
    sendKeys(herdr.binPath, paneId, "enter");
    if (options.seedText) sendText(herdr.binPath, paneId, options.seedText);
    return true;
  } catch {
    return false;
  }
}

function sendText(binPath: string, paneId: string, text: string): void {
  Bun.spawnSync([binPath, "pane", "send-text", paneId, text], {
    stdout: "ignore",
    stderr: "ignore",
    timeout: HERDR_SPAWN_TIMEOUT_MS,
  });
}

function sendKeys(binPath: string, paneId: string, keys: string): void {
  Bun.spawnSync([binPath, "pane", "send-keys", paneId, keys], {
    stdout: "ignore",
    stderr: "ignore",
    timeout: HERDR_SPAWN_TIMEOUT_MS,
  });
}
