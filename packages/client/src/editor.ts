/**
 * File-level edit mode = the editor hand-off: write the working copy to a temp
 * file, run the reviewer's editor on it, read the result back. Editing must
 * work with zero configuration, so the resolution chain ends in a terminal
 * fallback that is always present. A GUI editor launched without a wait flag
 * forks and returns instantly, losing the edit silently; known GUI editors get
 * their wait flag applied, and any editor that still returns right away with an
 * untouched file drops to a confirm gate rather than discarding the work.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface EditResult {
  content: string;
  changed: boolean;
}

/** Present on every POSIX system, so a clean shell can still edit. */
const DEFAULT_EDITOR = "nano";

/** GUI editors fork and return immediately unless given their wait flag. */
const GUI_WAIT_FLAGS: Record<string, string[]> = {
  code: ["--wait"],
  "code-insiders": ["--wait"],
  codium: ["--wait"],
  cursor: ["--wait"],
  windsurf: ["--wait"],
  subl: ["--new-window", "--wait"],
  sublime_text: ["--new-window", "--wait"],
  zed: ["--wait"],
  bbedit: ["--wait"],
  mate: ["--wait"],
  gedit: ["--wait"],
  kate: ["--block"],
  idea: ["--wait"],
  webstorm: ["--wait"],
};

/** Editors that hold the terminal themselves - never GUI, never a wait gate. */
const TERMINAL_EDITORS = new Set([
  "vi",
  "vim",
  "nvim",
  "nano",
  "pico",
  "emacs",
  "emacsclient",
  "micro",
  "hx",
  "helix",
  "kak",
  "ed",
  "joe",
  "mcedit",
]);

export interface ResolvedEditor {
  argv: string[];
  /** True when this editor blocks the hand-off until the file is closed - a
   * terminal editor, or a known GUI editor with its wait flag applied. */
  waits: boolean;
}

/** The editor to run: [ui] editor, then the environment chain, then nano. */
export function resolveEditor(
  configuredEditor: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  const candidates = [configuredEditor, env.CUELOOP_EDITOR, env.VISUAL, env.EDITOR];
  return candidates.find((candidate) => candidate && candidate.trim())?.trim() ?? DEFAULT_EDITOR;
}

function editorBaseName(command: string): string {
  return (command.split(/[\\/]/).pop() ?? command).toLowerCase();
}

/** Split the editor string and apply a GUI wait flag when we know one. */
export function resolveEditorCommand(rawEditor: string): ResolvedEditor {
  const parts = rawEditor.trim().split(/\s+/);
  const base = editorBaseName(parts[0] ?? "");
  if (TERMINAL_EDITORS.has(base)) return { argv: parts, waits: true };
  const waitFlags = GUI_WAIT_FLAGS[base];
  if (waitFlags) {
    const alreadyWaits = parts.some(
      (part) => part === "--wait" || part === "-w" || part === "--block",
    );
    return { argv: alreadyWaits ? parts : [...parts, ...waitFlags], waits: true };
  }
  return { argv: parts, waits: false };
}

/** A fast return with an untouched file means the editor probably did not wait. */
const NO_WAIT_THRESHOLD_MS = 1000;

function suspectsNoWait(resolved: ResolvedEditor, elapsedMs: number, unchanged: boolean): boolean {
  if (resolved.waits) return false; // holds the terminal or has a wait flag - trust the exit
  if (!unchanged) return false; // edits landed, so it waited after all
  return elapsedMs < NO_WAIT_THRESHOLD_MS;
}

export interface EditHandOff {
  /** Editor from [ui] editor config; overrides the environment. */
  editor?: string;
  env?: Record<string, string | undefined>;
  /** Confirm gate for a suspected no-wait return; true re-reads the file. */
  confirmSaved?: (editorLabel: string, path: string) => boolean;
  now?: () => number;
}

/** Prompt on the released terminal during the suspend window. */
function promptSaved(editorLabel: string, path: string): boolean {
  const answer = prompt(
    `${editorLabel} returned immediately and the plan is unchanged - a GUI editor needs its wait flag. Save and close ${path}, then press Enter to load your edits (or type n to skip):`,
  );
  return answer !== null && answer.trim().toLowerCase() !== "n";
}

export function editInEditor(
  content: string,
  filename = "plan.md",
  handOff: EditHandOff = {},
): EditResult {
  const env = handOff.env ?? process.env;
  const now = handOff.now ?? Date.now;
  const resolved = resolveEditorCommand(resolveEditor(handOff.editor, env));
  const dir = mkdtempSync(join(tmpdir(), "cueloop-edit-"));
  const path = join(dir, filename);
  writeFileSync(path, content);
  try {
    const startedAt = now();
    const editorProcess = Bun.spawnSync([...resolved.argv, path], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (editorProcess.exitCode !== 0) throw new Error(`editor exited ${editorProcess.exitCode}`);
    let next = readFileSync(path, "utf8");
    if (suspectsNoWait(resolved, now() - startedAt, next === content)) {
      const confirm = handOff.confirmSaved ?? promptSaved;
      if (confirm(resolved.argv[0] ?? "the editor", path)) next = readFileSync(path, "utf8");
    }
    return { content: next, changed: next !== content };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
