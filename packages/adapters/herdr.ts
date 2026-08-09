/**
 * herdr agent-state reporting over the ambient env contract: a process inside
 * a herdr pane sees HERDR_ENV=1 plus the pane id and binary path, and cueloop
 * reports semantic agent state (blocked while a review waits, working after
 * the verdict) plus a sidebar label through the herdr CLI.
 * This is tier 1 (no plugin, no socket); the herdr plugin tier builds on it.
 * Invariants: fire-and-forget (reporting never blocks or throws); outside
 * herdr every call is a no-op, so a plain terminal behaves byte-identically;
 * tests point HERDR_BIN_PATH at a stub script.
 */

export type HerdrAgentState = "blocked" | "working" | "done" | "idle";

export interface HerdrContext {
  paneId: string;
  binPath: string;
}

const SOURCE = "custom:cueloop";
const LABEL_TTL_MS = 3_600_000;

type Env = Record<string, string | undefined>;

/** The pane's ambient contract, or null outside herdr. */
export function detectHerdr(env: Env = process.env): HerdrContext | null {
  if (env.HERDR_ENV !== "1") return null;
  const paneId = env.HERDR_PANE_ID;
  const binPath = env.HERDR_BIN_PATH;
  if (!paneId || !binPath) return null;
  return { paneId, binPath };
}

/** Report semantic agent state for this pane. No-op outside herdr. */
export function reportState(state: HerdrAgentState, env: Env = process.env): void {
  const herdr = detectHerdr(env);
  if (!herdr) return;
  spawnQuiet([herdr.binPath, "pane", "report-agent", herdr.paneId, "--source", SOURCE, "--state", state]);
}

/** Report a sidebar metadata label for this pane. No-op outside herdr. */
export function reportLabel(text: string, env: Env = process.env): void {
  const herdr = detectHerdr(env);
  if (!herdr) return;
  spawnQuiet([
    herdr.binPath,
    "pane",
    "report-metadata",
    herdr.paneId,
    "--source",
    SOURCE,
    "--token",
    `summary=${text}`,
    "--ttl-ms",
    String(LABEL_TTL_MS),
  ]);
}

function spawnQuiet(command: string[]): void {
  try {
    Bun.spawn(command, { stdio: ["ignore", "ignore", "ignore"] }).unref();
  } catch {
    // best-effort reporting: a missing or broken binary is not our failure
  }
}
