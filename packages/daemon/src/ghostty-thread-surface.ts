/** Open or focus a cueloop Thread through Ghostty's macOS AppleScript API. */

import type { Thread, ThreadSurfaceOpenStatus } from "@cueloop/schema";
import type { GhosttyThreadSurfaceHandle } from "./ghostty-thread-surface-store";
import { loadGhosttyThreadSurface, type GhosttyThreadSurface } from "./thread-surface-config";

const APPLESCRIPT_TIMEOUT_MS = 10000;
const VERSION_SCRIPT = 'tell application "Ghostty" to get version';
export const GHOSTTY_OPEN_APPLESCRIPT = `on run argv
  set placement to item 1 of argv
  set threadCommand to item 2 of argv
  set threadDirectory to item 3 of argv
  set shellCommand to item 4 of argv
  tell application "Ghostty"
    if placement is "tab" then
      set targetWindow to front window
      set beforeCount to count of tabs of targetWindow
      set sourceTerminal to focused terminal of selected tab of targetWindow
      if not (perform action "new_tab" on sourceTerminal) then error "Ghostty rejected new_tab"
      repeat 50 times
        if (count of tabs of targetWindow) > beforeCount then exit repeat
        delay 0.1
      end repeat
      if (count of tabs of targetWindow) <= beforeCount then error "Ghostty did not create a tab"
      set createdTab to selected tab of targetWindow
      try
        set createdTerminal to focused terminal of createdTab
        repeat 50 times
          if (name of createdTerminal) is not "👻" then exit repeat
          delay 0.1
        end repeat
        if (name of createdTerminal) is "👻" then error "Ghostty tab has no shell"
        input text shellCommand to createdTerminal
        send key "enter" to createdTerminal
        focus createdTerminal
        return id of createdTerminal
      on error
        close tab createdTab
        error "Ghostty tab did not launch the Thread"
      end try
    end if
    set cfg to new surface configuration
    set initial working directory of cfg to threadDirectory
    set command of cfg to threadCommand
    if placement is "window" then
      set createdWindow to new window with configuration cfg
      try
        set createdTerminal to focused terminal of selected tab of createdWindow
        focus createdTerminal
        return id of createdTerminal
      on error
        close window createdWindow
        error "Ghostty window did not launch the Thread"
      end try
    end if
    set targetWindow to front window
    set sourceTerminal to focused terminal of selected tab of targetWindow
    set createdTerminal to split sourceTerminal direction right with configuration cfg
    try
      focus createdTerminal
      return id of createdTerminal
    on error
      close createdTerminal
      error "Ghostty pane did not launch the Thread"
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

export interface GhosttyThreadSurfacePersistence {
  ghosttyGetThreadSurface(threadId: string): Promise<GhosttyThreadSurfaceHandle | null>;
  ghosttySetThreadSurface(threadId: string, handle: GhosttyThreadSurfaceHandle): Promise<void>;
}

export interface GhosttyEnv {
  [name: string]: string | undefined;
  TERM_PROGRAM?: string;
  GHOSTTY_RESOURCES_DIR?: string;
}

function runAppleScript(binPath: string, script: string, args: string[] = []): string | null {
  try {
    const result = Bun.spawnSync([binPath, "-e", script, ...args], {
      stdout: "pipe",
      stderr: "ignore",
      timeout: APPLESCRIPT_TIMEOUT_MS,
    });

    return result.exitCode === 0 ? result.stdout.toString().trim() : null;
  } catch {
    return null;
  }
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
): Promise<ThreadSurfaceOpenStatus> {
  if (platform !== "darwin" || !insideGhostty(env)) return "unavailable";
  if (mode === "none") return "disabled";
  if (!supportsGhosttyAppleScript(runAppleScript(binPath, VERSION_SCRIPT))) return "failed";

  let recorded: GhosttyThreadSurfaceHandle | null = null;

  try {
    recorded = await persistence.ghosttyGetThreadSurface(thread.id);
  } catch {
    // A stale daemon must not hide the pending Thread.
  }

  if (recorded) {
    const result = runAppleScript(binPath, FOCUS_SCRIPT, [recorded.terminalId]);

    if (result === "focused") return "focused";
    if (result !== "closed") return "failed";
  }

  const cwd = thread.artifact.meta.cwd ?? thread.workspace.repoRoot;
  const terminalId = runAppleScript(binPath, GHOSTTY_OPEN_APPLESCRIPT, [
    mode,
    `cueloop ${thread.id}`,
    cwd,
    `cd -- ${shellQuote(cwd)} && cueloop ${shellQuote(thread.id)}`,
  ]);

  if (!terminalId) return "failed";

  try {
    await persistence.ghosttySetThreadSurface(thread.id, { terminalId });
  } catch {
    // Opening is best-effort; a later request can still use the manual command.
  }

  return "opened";
}
