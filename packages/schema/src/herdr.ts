/**
 * The herdr ambient env contract, single-sourced. A process running inside a
 * herdr pane sees HERDR_ENV=1 plus the pane id; the herdr CLI itself reaches
 * the app over HERDR_SOCKET_PATH (which the spawned `herdr` reads from the
 * inherited env), so the binary is just `herdr` on PATH. Both the agent-side
 * reporter (adapters) and the reviewer-side return-focus (client) read this
 * contract; decoding it in one place stops the two sides drifting on which
 * vars are required. Pure: no IO, env is only the default argument so callers
 * can pass a fixture.
 */

export interface HerdrContext {
  paneId: string;
  binPath: string;
}

export type HerdrEnv = Record<string, string | undefined>;

/**
 * The pane's full contract - pane id and binary path - or null outside a
 * functioning herdr. Required by anything that spawns the herdr CLI.
 */
export function detectHerdr(env: HerdrEnv = process.env): HerdrContext | null {
  if (env.HERDR_ENV !== "1") return null;
  const paneId = env.HERDR_PANE_ID;

  if (!paneId) return null;
  // herdr 0.8.0 exposes no HERDR_BIN_PATH; the CLI is `herdr` on PATH and finds
  // the app over HERDR_SOCKET_PATH from the inherited env. Tests still override
  // HERDR_BIN_PATH to point the spawn at a stub script.
  const binPath = env.HERDR_BIN_PATH ?? "herdr";

  return { paneId, binPath };
}

/** True whenever this process runs inside a herdr pane. */
export function insideHerdr(env: HerdrEnv = process.env): boolean {
  return env.HERDR_ENV === "1";
}

/**
 * The pane a closing review should hand focus back to: the opener's
 * CUELOOP_RETURN_PANE, or the session's recorded pane, but never this pane
 * itself. Undefined outside herdr or when the only candidate is our own pane.
 */
export function returnPaneFor(
  sessionHerdrPane?: string,
  env: HerdrEnv = process.env,
): string | undefined {
  if (!insideHerdr(env)) return undefined;
  const pane = env.CUELOOP_RETURN_PANE ?? sessionHerdrPane;

  return pane && pane !== env.HERDR_PANE_ID ? pane : undefined;
}
