/** Open or focus a cueloop Thread through Ghostty's macOS AppleScript API. */

import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join } from "node:path";
import type { Thread, ThreadSurfaceOpenStatus } from "@cueloop/schema";
import type { GhosttyThreadSurfaceHandle } from "./ghostty-thread-surface-store";
import { loadGhosttyThreadSurface, type GhosttyThreadSurface } from "./thread-surface-config";

const APPLESCRIPT_TIMEOUT_MS = 10000;
const VERSION_SCRIPT = 'tell application "Ghostty" to get version';
export const GHOSTTY_OPEN_APPLESCRIPT = `on run argv
  set placement to item 1 of argv
  set threadDirectory to item 2 of argv
  set shellCommand to item 3 of argv
  tell application "Ghostty"
    if placement is "tab" then
      set targetWindow to front window
      set beforeCount to count of tabs of targetWindow
      set beforeIds to id of every tab of targetWindow
      set sourceTerminal to focused terminal of selected tab of targetWindow
      if not (perform action "new_tab" on sourceTerminal) then error "Ghostty rejected new_tab"
      repeat 50 times
        if (count of tabs of targetWindow) > beforeCount then exit repeat
        delay 0.1
      end repeat
      if (count of tabs of targetWindow) <= beforeCount then error "Ghostty did not create a tab"
      set newTabs to {}
      repeat with candidateTab in tabs of targetWindow
        if (id of candidateTab) is not in beforeIds then set end of newTabs to candidateTab
      end repeat
      if (count of newTabs) is not 1 then error "Ghostty tab identity is ambiguous"
      set createdTab to item 1 of newTabs
      set createdTerminal to focused terminal of createdTab
    else
      set cfg to new surface configuration
      set initial working directory of cfg to threadDirectory
      if placement is "window" then
        set createdWindow to new window with configuration cfg
        set createdTerminal to focused terminal of selected tab of createdWindow
      else
        set targetWindow to front window
        set sourceTerminal to focused terminal of selected tab of targetWindow
        set createdTerminal to split sourceTerminal direction right with configuration cfg
      end if
    end if
    try
      repeat 50 times
        if (name of createdTerminal) is not "👻" and (name of createdTerminal) is not "" then exit repeat
        delay 0.1
      end repeat
      if (name of createdTerminal) is "👻" or (name of createdTerminal) is "" then error "Ghostty surface has no shell"
      input text shellCommand to createdTerminal
      send key "enter" to createdTerminal
      focus createdTerminal
      return id of createdTerminal
    on error
      if placement is "tab" then
        close tab createdTab
      else if placement is "window" then
        close window createdWindow
      else
        close createdTerminal
      end if
      error "Ghostty surface did not launch the Thread"
    end try
  end tell
end run`;
const FOCUS_SCRIPT = `on run argv
  set targetId to item 1 of argv
  tell application "Ghostty"
    repeat with candidate in terminals
      if (id of candidate) is targetId then
        focus candidate
        return "focused"
      end if
    end repeat
  end tell
  return "closed"
end run`;
const CLOSE_SCRIPT = `on run argv
  set targetId to item 1 of argv
  tell application "Ghostty"
    repeat with candidate in terminals
      if (id of candidate) is targetId then
        close candidate
        return "closed"
      end if
    end repeat
  end tell
  return "absent"
end run`;

export interface GhosttyThreadSurfacePersistence {
  ghosttyClaimThreadSurface(threadId: string): Promise<boolean>;
  ghosttyReleaseThreadSurface(threadId: string): Promise<void>;
  ghosttyGetThreadSurface(threadId: string): Promise<GhosttyThreadSurfaceHandle | null>;
  ghosttySetThreadSurface(threadId: string, handle: GhosttyThreadSurfaceHandle): Promise<void>;
}

export interface GhosttyEnv {
  [name: string]: string | undefined;
  TERM_PROGRAM?: string;
  GHOSTTY_RESOURCES_DIR?: string;
}

interface GhosttyLaunchResult {
  status: ThreadSurfaceOpenStatus;
  retainClaim: boolean;
}

function runAppleScript(binPath: string, script: string, args: string[] = []): string | null {
  try {
    const result = spawnSync(binPath, ["-e", script, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: APPLESCRIPT_TIMEOUT_MS,
    });

    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

function resolveCueloopExecutable(): string | null {
  if (basename(process.execPath) === "cueloop") return process.execPath;

  for (const entry of process.env.PATH?.split(delimiter) ?? []) {
    if (!isAbsolute(entry)) continue;
    const candidate = join(entry, "cueloop");

    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // A PATH entry without an executable cannot launch the Thread.
    }
  }

  return null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Ghostty 1.3.0 introduced the native AppleScript commands used here. */
export function supportsGhosttyAppleScript(version: string | null): boolean {
  const parsed = version?.match(/^(\d+)\.(\d+)\.(\d+)/);

  if (!parsed) return false;
  const major = Number(parsed[1]);
  const minor = Number(parsed[2]);

  return major > 1 || (major === 1 && minor >= 3);
}

/** Herdr selection happens before this adapter, even when it runs inside Ghostty. */
export function insideGhostty(env: GhosttyEnv = process.env): boolean {
  return env.TERM_PROGRAM?.toLowerCase() === "ghostty" || Boolean(env.GHOSTTY_RESOURCES_DIR);
}

/** Reuse a live Ghostty terminal, reopen a closed one, or leave the Thread pending. */
export async function openGhosttyThreadSurface(
  thread: Thread,
  persistence: GhosttyThreadSurfacePersistence,
  env: GhosttyEnv = process.env,
  mode: GhosttyThreadSurface = loadGhosttyThreadSurface(),
  binPath = "osascript",
  platform: NodeJS.Platform = process.platform,
  cueloopBinPath?: string | null,
): Promise<ThreadSurfaceOpenStatus> {
  if (platform !== "darwin" || !insideGhostty(env)) return "unavailable";
  if (mode === "none") return "disabled";
  if (!supportsGhosttyAppleScript(runAppleScript(binPath, VERSION_SCRIPT))) return "failed";

  try {
    if (!(await persistence.ghosttyClaimThreadSurface(thread.id))) return "failed";
  } catch {
    return "failed";
  }

  let result: GhosttyLaunchResult;

  try {
    result = await openClaimedGhosttyThreadSurface(
      thread,
      persistence,
      mode,
      binPath,
      cueloopBinPath,
    );
  } catch {
    result = { status: "failed", retainClaim: true };
  }

  if (result.retainClaim) return "failed";

  try {
    await persistence.ghosttyReleaseThreadSurface(thread.id);
  } catch {
    return "failed";
  }

  return result.status;
}

async function openClaimedGhosttyThreadSurface(
  thread: Thread,
  persistence: GhosttyThreadSurfacePersistence,
  mode: Exclude<GhosttyThreadSurface, "none">,
  binPath: string,
  cueloopBinPath?: string | null,
): Promise<GhosttyLaunchResult> {
  let recorded: GhosttyThreadSurfaceHandle | null;

  try {
    recorded = await persistence.ghosttyGetThreadSurface(thread.id);
  } catch {
    return { status: "failed", retainClaim: false };
  }

  if (recorded) {
    const result = runAppleScript(binPath, FOCUS_SCRIPT, [recorded.terminalId]);

    if (result === "focused") return { status: "focused", retainClaim: false };
    if (result !== "closed") return { status: "failed", retainClaim: false };
  }

  const executable = cueloopBinPath === undefined ? resolveCueloopExecutable() : cueloopBinPath;

  if (!executable) return { status: "failed", retainClaim: false };

  const cwd = thread.artifact.meta.cwd ?? thread.workspace.repoRoot;
  const terminalId = runAppleScript(binPath, GHOSTTY_OPEN_APPLESCRIPT, [
    mode,
    cwd,
    `cd -- ${shellQuote(cwd)} && ${shellQuote(executable)} ${shellQuote(thread.id)}`,
  ]);

  if (!terminalId) return { status: "failed", retainClaim: false };

  try {
    await persistence.ghosttySetThreadSurface(thread.id, { terminalId });
  } catch {
    const closed = runAppleScript(binPath, CLOSE_SCRIPT, [terminalId]);

    return { status: "failed", retainClaim: closed !== "closed" && closed !== "absent" };
  }

  return { status: "opened", retainClaim: false };
}
