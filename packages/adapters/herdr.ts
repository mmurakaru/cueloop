/**
 * herdr tier-1 integration: the zero-install env contract.
 *
 * Any process inside a herdr pane sees HERDR_ENV=1 plus the pane id and the
 * herdr binary path. cueloop uses only that ambient contract here: report
 * semantic agent state (blocked while a review waits, working after the
 * verdict) and a sidebar metadata label. No plugin, no socket - tier 2 (the
 * herdr plugin) builds on top of this.
 *
 * Invariants:
 * - Fire-and-forget: reporting never blocks or throws; a broken herdr binary
 *   must never disturb the review flow it decorates.
 * - Fallback parity: outside herdr (HERDR_ENV unset) every call is a no-op,
 *   so behavior in a plain terminal is byte-identical.
 * - Tests point HERDR_BIN_PATH at a stub script; the binary path is the
 *   override, no extra knob.
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
