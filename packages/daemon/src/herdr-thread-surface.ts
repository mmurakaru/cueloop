import {
  detectHerdr,
  type HerdrEnv,
  type Thread,
  type ThreadSurfaceOpenStatus,
} from "@cueloop/schema";
import { spawnSync } from "node:child_process";
import * as v from "valibot";
import type { HerdrThreadSurfaceHandle } from "./herdr-thread-surface-store";
import { loadHerdrThreadSurface, type HerdrThreadSurface } from "./thread-surface-config";

const HERDR_SPAWN_TIMEOUT_MS = 2000;

interface HerdrCommandResult {
  exitCode: number;
  stdout: Buffer;
}

function runHerdrCommand(
  command: string[],
  options: { stdout: "pipe" | "ignore"; stderr: "ignore"; timeout: number },
): HerdrCommandResult {
  const result = spawnSync(command[0]!, command.slice(1), {
    stdio: ["ignore", options.stdout, options.stderr],
    timeout: options.timeout,
  });

  return { exitCode: result.status ?? 1, stdout: result.stdout ?? Buffer.alloc(0) };
}
const CreatedTabSchema = v.object({
  result: v.optional(
    v.object({
      root_pane: v.optional(
        v.object({ pane_id: v.optional(v.string()), tab_id: v.optional(v.string()) }),
      ),
    }),
  ),
});
const PaneResultSchema = v.object({
  result: v.optional(v.object({ pane: v.optional(v.unknown()) })),
});
const CreatedPaneSchema = v.object({
  result: v.optional(v.object({ pane: v.optional(v.object({ pane_id: v.string() })) })),
});
const PaneNeighborSchema = v.object({
  result: v.object({
    neighbor: v.object({ neighbor_pane_id: v.optional(v.nullable(v.string())) }),
  }),
});
const PaneFocusSchema = v.object({
  result: v.optional(
    v.object({ focus: v.optional(v.object({ focused_pane_id: v.nullable(v.string()) })) }),
  ),
});

/** Inputs for a new Herdr Thread tab. */
export interface OpenHerdrThreadTabOptions {
  sessionId: string;
  cwd: string;
  binPath: string;
  label: string;
  workspaceId?: string;
}

/** Daemon-owned native handles, separate from canonical Thread records. */
export interface HerdrThreadSurfacePersistence {
  herdrGetThreadSurface(sessionId: string): Promise<HerdrThreadSurfaceHandle | null>;
  herdrSetThreadSurface(sessionId: string, handle: HerdrThreadSurfaceHandle): Promise<void>;
}

/** Open a focused Herdr tab; keep both native IDs for later liveness checks. */
export function openHerdrThreadTab(
  options: OpenHerdrThreadTabOptions,
): HerdrThreadSurfaceHandle | null {
  const { sessionId, cwd, binPath, label, workspaceId } = options;

  try {
    const created = runHerdrCommand(
      [
        binPath,
        "tab",
        "create",
        ...(workspaceId ? ["--workspace", workspaceId] : []),
        "--cwd",
        cwd,
        "--label",
        label,
        "--focus",
      ],
      { stdout: "pipe", stderr: "ignore", timeout: HERDR_SPAWN_TIMEOUT_MS },
    );

    if (created.exitCode !== 0) return null;
    const parsed = v.safeParse(CreatedTabSchema, JSON.parse(created.stdout.toString()));

    if (!parsed.success) return null;
    const paneId = parsed.output.result?.root_pane?.pane_id;
    const tabId = parsed.output.result?.root_pane?.tab_id;

    if (!paneId || !tabId) return null;

    if (!sendCueloopThreadCommand(binPath, paneId, sessionId)) {
      closeUnlaunchedHerdrSurface(binPath, "tab", tabId);

      return null;
    }

    return { tabId, paneId };
  } catch {
    return null;
  }
}

/** Inputs for a focused right-hand Herdr Thread pane. */
export interface OpenHerdrThreadPaneOptions {
  sessionId: string;
  cwd: string;
  binPath: string;
  sourcePaneId: string;
  tabId: string;
}

/** Split the calling Herdr pane right at 50 percent and launch cueloop in it. */
export function openHerdrThreadPane(
  options: OpenHerdrThreadPaneOptions,
): HerdrThreadSurfaceHandle | null {
  const { sessionId, cwd, binPath, sourcePaneId, tabId } = options;

  try {
    const created = runHerdrCommand(
      [
        binPath,
        "pane",
        "split",
        sourcePaneId,
        "--direction",
        "right",
        "--ratio",
        "0.5",
        "--cwd",
        cwd,
        "--focus",
      ],
      { stdout: "pipe", stderr: "ignore", timeout: HERDR_SPAWN_TIMEOUT_MS },
    );

    if (created.exitCode !== 0) return null;
    const parsed = v.safeParse(CreatedPaneSchema, JSON.parse(created.stdout.toString()));
    const paneId = parsed.success ? parsed.output.result?.pane?.pane_id : undefined;

    if (!paneId) return null;
    if (!sendCueloopThreadCommand(binPath, paneId, sessionId)) {
      closeUnlaunchedHerdrSurface(binPath, "pane", paneId);

      return null;
    }

    return { mode: "pane", tabId, paneId };
  } catch {
    return null;
  }
}

function closeUnlaunchedHerdrSurface(binPath: string, kind: "tab" | "pane", id: string): void {
  try {
    runHerdrCommand([binPath, kind, "close", id], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: HERDR_SPAWN_TIMEOUT_MS,
    });
  } catch {
    // The pending Thread remains available through the manual command.
  }
}

function sendCueloopThreadCommand(binPath: string, paneId: string, sessionId: string): boolean {
  const typed = runHerdrCommand([binPath, "pane", "send-text", paneId, `cueloop ${sessionId}`], {
    stdout: "ignore",
    stderr: "ignore",
    timeout: HERDR_SPAWN_TIMEOUT_MS,
  });

  if (typed.exitCode !== 0) return false;
  const entered = runHerdrCommand([binPath, "pane", "send-keys", paneId, "enter"], {
    stdout: "ignore",
    stderr: "ignore",
    timeout: HERDR_SPAWN_TIMEOUT_MS,
  });

  return entered.exitCode === 0;
}

/** Check the recorded pane ID before deciding whether to reopen. */
function herdrPaneAlive(binPath: string, paneId: string): boolean {
  try {
    const got = runHerdrCommand([binPath, "pane", "get", paneId], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: HERDR_SPAWN_TIMEOUT_MS,
    });

    if (got.exitCode !== 0) return false;
    const parsed = v.safeParse(PaneResultSchema, JSON.parse(got.stdout.toString()));

    return parsed.success && parsed.output.result?.pane != null;
  } catch {
    return false;
  }
}

/** Focus a recorded Herdr tab. */
function focusHerdrTab(binPath: string, tabId: string): boolean {
  try {
    const focused = runHerdrCommand([binPath, "tab", "focus", tabId], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: HERDR_SPAWN_TIMEOUT_MS,
    });

    return focused.exitCode === 0;
  } catch {
    return false;
  }
}

function focusHerdrThreadSurface(binPath: string, handle: HerdrThreadSurfaceHandle): boolean {
  if (!focusHerdrTab(binPath, handle.tabId)) return false;

  if (handle.mode !== "pane") return true;

  try {
    const directions = [
      ["left", "right"],
      ["right", "left"],
      ["up", "down"],
      ["down", "up"],
    ] as const;
    let hasNeighbor = false;

    for (const [direction, opposite] of directions) {
      const neighbor = herdrPaneNeighbor(binPath, handle.paneId, direction);

      if (neighbor === undefined) return false;
      if (neighbor === null) continue;
      hasNeighbor = true;

      if (herdrPaneNeighbor(binPath, neighbor, opposite) !== handle.paneId) continue;
      const focused = runHerdrCommand(
        [binPath, "pane", "focus", "--pane", neighbor, "--direction", opposite],
        { stdout: "pipe", stderr: "ignore", timeout: HERDR_SPAWN_TIMEOUT_MS },
      );
      const parsed = v.safeParse(PaneFocusSchema, JSON.parse(focused.stdout.toString()));

      if (
        focused.exitCode === 0 &&
        parsed.success &&
        parsed.output.result?.focus?.focused_pane_id === handle.paneId
      ) {
        return true;
      }
    }

    return !hasNeighbor;
  } catch {
    return false;
  }
}

function herdrPaneNeighbor(
  binPath: string,
  paneId: string,
  direction: string,
): string | null | undefined {
  try {
    const neighbor = runHerdrCommand(
      [binPath, "pane", "neighbor", "--pane", paneId, "--direction", direction],
      { stdout: "pipe", stderr: "ignore", timeout: HERDR_SPAWN_TIMEOUT_MS },
    );

    if (neighbor.exitCode !== 0) return undefined;
    const parsed = v.safeParse(PaneNeighborSchema, JSON.parse(neighbor.stdout.toString()));

    return parsed.success ? (parsed.output.result.neighbor.neighbor_pane_id ?? null) : undefined;
  } catch {
    return undefined;
  }
}

/** Reuse a live Thread surface, reopen a closed one, or report a manual fallback. */
export async function openHerdrThreadSurface(
  session: Thread,
  persistence: HerdrThreadSurfacePersistence,
  env: HerdrEnv = process.env,
  mode: HerdrThreadSurface = loadHerdrThreadSurface(),
): Promise<ThreadSurfaceOpenStatus> {
  const herdr = detectHerdr(env);

  if (!herdr) return "unavailable";

  if (mode === "none") return "disabled";
  const recorded = await recallHerdrThreadSurface(persistence, session.id);

  if (recorded && herdrPaneAlive(herdr.binPath, recorded.paneId)) {
    return focusHerdrThreadSurface(herdr.binPath, recorded) ? "focused" : "failed";
  }
  const cwd = session.artifact.meta.cwd ?? session.workspace.repoRoot;
  const opened =
    mode === "pane"
      ? env.HERDR_TAB_ID
        ? openHerdrThreadPane({
            sessionId: session.id,
            cwd,
            binPath: herdr.binPath,
            sourcePaneId: herdr.paneId,
            tabId: env.HERDR_TAB_ID,
          })
        : null
      : openHerdrThreadTab({
          sessionId: session.id,
          cwd,
          binPath: herdr.binPath,
          label: session.artifact.meta.title ?? session.id,
          workspaceId: env.HERDR_WORKSPACE_ID,
        });

  if (!opened) return "failed";
  await rememberHerdrThreadSurface(persistence, session.id, opened);

  return "opened";
}

/** A stale daemon cannot prevent the reviewer from opening the pending Thread. */
async function recallHerdrThreadSurface(
  persistence: HerdrThreadSurfacePersistence,
  sessionId: string,
): Promise<HerdrThreadSurfaceHandle | null> {
  try {
    return await persistence.herdrGetThreadSurface(sessionId);
  } catch {
    return null;
  }
}

/** Handle persistence is best-effort after the new terminal has opened. */
async function rememberHerdrThreadSurface(
  persistence: HerdrThreadSurfacePersistence,
  sessionId: string,
  handle: HerdrThreadSurfaceHandle,
): Promise<void> {
  try {
    await persistence.herdrSetThreadSurface(sessionId, handle);
  } catch {
    // The Thread remains pending even if the old daemon cannot store this handle.
  }
}
