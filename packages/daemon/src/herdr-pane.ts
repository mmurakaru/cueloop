/**
 * Creation-side herdr pane opener: when a review is created from inside a
 * herdr pane, cueloop opens a NEW herdr tab that renders the review, so the
 * creator does not have to run a command by hand. This is the counterpart to
 * the reviewer-side focusHerdrPane in @cueloop/client. It lives here, beside
 * the shared review core (openReview), because both creation sites - the
 * Claude Code hook and the `cueloop session create` CLI - already depend on
 * this package and drive creation through it, so a single home reaches both
 * with no new cross-package dependency.
 *
 * A fresh tab hosts a plain shell with no command argument, so the review is
 * launched exactly as a human would: type `cueloop <sessionId>` into the new
 * pane and press enter. The herdr CLI is spawned synchronously because the
 * send-text and send-keys steps need the pane id that `tab create` returns.
 *
 * Best-effort like the rest of the herdr tier: a missing or broken binary, an
 * unexpected JSON shape, or any spawn failure is swallowed and never blocks
 * review creation. Each spawn is bounded by HERDR_SPAWN_TIMEOUT_MS so a hung
 * herdr binary cannot stall the review-creation path - a timeout kills the
 * child and reads as a non-zero exit, i.e. a best-effort bail-out.
 */

import { detectHerdr, type HerdrEnv, type ReviewSession } from "@cueloop/schema";

/** Upper bound per herdr spawn, so a stuck binary can never block creation. */
const HERDR_SPAWN_TIMEOUT_MS = 2000;

export interface OpenHerdrPaneOptions {
  /** The review session id; `cueloop <sessionId>` opens it in the new pane. */
  sessionId: string;
  /** Working directory for the new tab; the review's cwd. */
  cwd: string;
  /** Absolute path to the herdr binary, from the ambient env contract. */
  binPath: string;
  /** Sidebar label for the new tab. */
  label: string;
}

/**
 * Open a herdr tab that renders the review. `tab create` prints a JSON result
 * shaped like `{ result: { pane: { id } } }` - the same `result.pane` nesting
 * focusHerdrPane reads - and the pane id drives the two follow-up steps.
 * Returns true when the full open-and-launch sequence completed, false on any
 * best-effort bail-out.
 */
export function openHerdrPane(options: OpenHerdrPaneOptions): boolean {
  const { sessionId, cwd, binPath, label } = options;
  try {
    const created = Bun.spawnSync([binPath, "tab", "create", "--cwd", cwd, "--label", label, "--focus"], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: HERDR_SPAWN_TIMEOUT_MS,
    });
    if (created.exitCode !== 0) return false;
    const parsed = JSON.parse(created.stdout.toString()) as { result?: { pane?: { id?: string } } };
    const paneId = parsed.result?.pane?.id;
    if (!paneId) return false;
    // A fresh tab hosts a plain shell, so the review is typed in like a human.
    const typed = Bun.spawnSync([binPath, "pane", "send-text", paneId, `cueloop ${sessionId}`], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: HERDR_SPAWN_TIMEOUT_MS,
    });
    if (typed.exitCode !== 0) return false;
    return (
      Bun.spawnSync([binPath, "pane", "send-keys", paneId, "enter"], {
        stdout: "ignore",
        stderr: "ignore",
        timeout: HERDR_SPAWN_TIMEOUT_MS,
      }).exitCode === 0
    );
  } catch {
    return false;
  }
}

/**
 * Open a pane for a freshly created review, guarded for the one case that
 * wants it: inside herdr and genuinely new. A revision reuses the pane the
 * original review already opened, so a resubmit (revisions beyond the first)
 * never spawns another tab. A no-op outside herdr keeps a plain terminal
 * byte-identical.
 */
export function openHerdrPaneForReview(session: ReviewSession, env: HerdrEnv = process.env): void {
  const herdr = detectHerdr(env);
  if (!herdr) return;
  if (session.revisions.length !== 1) return;
  openHerdrPane({
    sessionId: session.id,
    cwd: session.artifact.meta.cwd ?? process.cwd(),
    binPath: herdr.binPath,
    label: session.artifact.meta.title ?? session.id,
  });
}
