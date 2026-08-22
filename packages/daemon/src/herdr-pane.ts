/**
 * Opens a herdr tab that renders a review, from the creation sites (the Claude
 * Code hook and `cueloop session create`) that run inside a herdr pane. On a
 * resubmit it reopens only when the recorded pane is dead, so a live tab is
 * focused rather than duplicated. Best-effort: any spawn failure is swallowed
 * and never blocks review creation; each spawn is bounded by a timeout.
 */

import { detectHerdr, type HerdrEnv, type ReviewSession } from "@cueloop/schema";
import type { HerdrTabHandle } from "./herdr-tab-store";

const HERDR_SPAWN_TIMEOUT_MS = 2000;

export interface OpenHerdrPaneOptions {
  sessionId: string;
  cwd: string;
  binPath: string;
  label: string;
}

/** The daemon-side handle store, as the two methods this module needs. DaemonClient satisfies it. */
export interface HerdrTabPersistence {
  herdrGetTab(sessionId: string): Promise<HerdrTabHandle | null>;
  herdrSetTab(sessionId: string, handle: HerdrTabHandle): Promise<void>;
}

/**
 * Open a focused tab and launch the review in it. `tab create` prints
 * `{ result: { root_pane: { pane_id, tab_id } } }` (herdr 0.8.2); both ids are
 * returned so a later resubmit can liveness-check and focus. Null on any
 * best-effort bail-out.
 */
export function openHerdrPane(options: OpenHerdrPaneOptions): HerdrTabHandle | null {
  const { sessionId, cwd, binPath, label } = options;
  try {
    const created = Bun.spawnSync(
      [binPath, "tab", "create", "--cwd", cwd, "--label", label, "--focus"],
      { stdout: "pipe", stderr: "ignore", timeout: HERDR_SPAWN_TIMEOUT_MS },
    );
    if (created.exitCode !== 0) return null;
    const parsed = JSON.parse(created.stdout.toString()) as {
      result?: { root_pane?: { pane_id?: string; tab_id?: string } };
    };
    const paneId = parsed.result?.root_pane?.pane_id;
    const tabId = parsed.result?.root_pane?.tab_id;
    if (!paneId || !tabId) return null;
    // A fresh tab hosts a plain shell, so the review is typed in like a human.
    const typed = Bun.spawnSync([binPath, "pane", "send-text", paneId, `cueloop ${sessionId}`], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: HERDR_SPAWN_TIMEOUT_MS,
    });
    if (typed.exitCode !== 0) return null;
    const entered = Bun.spawnSync([binPath, "pane", "send-keys", paneId, "enter"], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: HERDR_SPAWN_TIMEOUT_MS,
    });
    return entered.exitCode === 0 ? { tabId, paneId } : null;
  } catch {
    return null;
  }
}

/** True when the pane still exists (`herdr pane get` returns it). */
function herdrPaneAlive(binPath: string, paneId: string): boolean {
  try {
    const got = Bun.spawnSync([binPath, "pane", "get", paneId], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: HERDR_SPAWN_TIMEOUT_MS,
    });
    if (got.exitCode !== 0) return false;
    const parsed = JSON.parse(got.stdout.toString()) as { result?: { pane?: unknown } };
    return parsed.result?.pane != null;
  } catch {
    return false;
  }
}

/** Bring an existing review tab to the front; best-effort. */
function focusHerdrTab(binPath: string, tabId: string): void {
  try {
    Bun.spawnSync([binPath, "tab", "focus", tabId], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: HERDR_SPAWN_TIMEOUT_MS,
    });
  } catch {
    // best-effort
  }
}

/**
 * Ensure a herdr tab is rendering this review. Inside herdr only: focus the
 * recorded tab if its pane is still alive, otherwise open a fresh one and record
 * its handle. No-op outside herdr.
 */
export async function openHerdrPaneForReview(
  session: ReviewSession,
  persistence: HerdrTabPersistence,
  env: HerdrEnv = process.env,
): Promise<void> {
  const herdr = detectHerdr(env);
  if (!herdr) return;
  const recorded = await persistence.herdrGetTab(session.id);
  if (recorded && herdrPaneAlive(herdr.binPath, recorded.paneId)) {
    focusHerdrTab(herdr.binPath, recorded.tabId);
    return;
  }
  const opened = openHerdrPane({
    sessionId: session.id,
    cwd: session.artifact.meta.cwd ?? process.cwd(),
    binPath: herdr.binPath,
    label: session.artifact.meta.title ?? session.id,
  });
  if (opened) await persistence.herdrSetTab(session.id, opened);
}
