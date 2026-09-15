/**
 * The session-level chords of the thread view. Letters in the thread view
 * type a comment, so everything that acts on the session as a whole - submit,
 * share, edit, the rail - lives on ctrl chords (cmd where the terminal
 * delivers it). The guided walk is a diff-review mode and has no chord here. Pure: the view reports whether a composer is open, this maps
 * a key to an intent or to nothing.
 */

import type { Intent } from "./keymap";

export interface ThreadChordKey {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  super?: boolean;
}

export interface ThreadChordContext {
  /** A composer owns the keyboard: chords never fire while one is open. */
  composing: boolean;
  /** Collaborators annotate only; submit, edit, and share are the owner's. */
  isOwner: boolean;
  /** A resolved session has nothing left to submit. */
  resolved: boolean;
  /** The rail shows the tree: next / previous move its selection instead of the cards. */
  treeActive: boolean;
  /** A diff review: the block chords act on the code row under the caret (reject, fold, walk). */
  isDiff?: boolean;
}

export const DEFAULT_LEADER = "ctrl+g";

export function leaderCombosFor(configured: readonly string[] | undefined): readonly string[] {
  return configured ?? [DEFAULT_LEADER];
}

const MOD_GLYPHS = new Map<string, string>([
  ["ctrl", "⌃"],
  ["control", "⌃"],
  ["meta", "⌥"],
  ["alt", "⌥"],
  ["option", "⌥"],
  ["shift", "⇧"],
  ["cmd", "⌘"],
  ["super", "⌘"],
]);

function comboParts(combo: string) {
  const parts = combo.split("+");

  return { mods: parts.slice(0, -1).map((part) => part.toLowerCase()), name: parts.at(-1) ?? "" };
}

export function leaderHint(combos: readonly string[]): string {
  const { mods, name } = comboParts(combos[0] ?? DEFAULT_LEADER);

  return `${mods.map((mod) => MOD_GLYPHS.get(mod) ?? mod).join("")}${name} `;
}

export function matchesLeader(
  key: { ctrl?: boolean; meta?: boolean; super?: boolean; name: string },
  combos: readonly string[],
): boolean {
  return combos.some((combo) => {
    const { mods, name } = comboParts(combo);

    return (
      key.name.toLowerCase() === name.toLowerCase() &&
      Boolean(key.ctrl) === (mods.includes("ctrl") || mods.includes("control")) &&
      Boolean(key.super) === (mods.includes("cmd") || mods.includes("super")) &&
      Boolean(key.meta) ===
        (mods.includes("meta") || mods.includes("alt") || mods.includes("option"))
    );
  });
}

export interface ChordEntry {
  keys: string;
  label: string;
}

/** The diff-review chords: the leader (or Option) plus a letter, on the caret's row or file. */
export function diffChordEntries(hint: string): ChordEntry[] {
  return [
    { keys: `${hint}x / ${hint}X`, label: "reject the change / the hunk" },
    { keys: `${hint}u`, label: "restore the last rejection" },
    { keys: `${hint}c`, label: "collapse the file to its band" },
    { keys: `${hint}d`, label: "split / stacked (when wide)" },
    { keys: `${hint}k`, label: "start the guided walk" },
  ];
}

/** The session chords stay on Ctrl, which terminals deliver reliably. */
export const THREAD_CHORD_ENTRIES = [
  { keys: "⌃enter", label: "submit the review" },
  { keys: "⌃e", label: "edit in $EDITOR" },
  { keys: "⌃s", label: "share" },
  { keys: "⌃r", label: "cycle the rail" },
] as const;

/** The rail and curation chords: the leader plus the plan sheet's old letter. */
export function railChordEntries(hint: string): ChordEntry[] {
  return [
    { keys: `${hint}n / ${hint}p`, label: "next / previous card" },
    { keys: `${hint}e`, label: "edit the card" },
    { keys: `${hint}⌫`, label: "delete the card" },
    { keys: `${hint}r`, label: "rename the author" },
    { keys: `${hint}x`, label: "cut the block" },
    { keys: `${hint}u`, label: "restore the last cut" },
    { keys: "⌥w / ⌥s", label: "widen / narrow the rail" },
  ];
}

/** The tree chords: the leader plus a letter, all on the rail's Tree tab. */
export function treeChordEntries(hint: string): ChordEntry[] {
  return [
    { keys: `${hint}t`, label: "show / hide the tree" },
    { keys: `${hint}n / ${hint}p`, label: "next / previous entry" },
    { keys: `${hint}g`, label: "go to the entry" },
    { keys: `${hint}b`, label: "branch off the tip" },
    { keys: `${hint}l`, label: "label a checkpoint" },
    { keys: `${hint}f`, label: "fork the path" },
    { keys: `${hint}h`, label: "fork and hand off" },
  ];
}

export function resolveThreadChord(
  key: ThreadChordKey,
  context: ThreadChordContext,
): Intent | null {
  if (context.composing) return null;
  const modified = Boolean(key.ctrl || key.meta || key.super);

  if (!modified) return null;
  if (key.name === "return" || key.name === "enter") {
    if (!context.isOwner) return READ_ONLY;

    return context.resolved ? null : { type: "openSubmit" };
  }
  if (key.ctrl) return resolveSessionChord(key.name, context);
  if (key.meta)
    return (
      (context.isDiff && resolveDiffChord(key.name, context)) || resolveRailChord(key.name, context)
    );

  return null;
}

export function resolveLeaderCommand(
  key: ThreadChordKey,
  context: ThreadChordContext,
): Intent | null {
  if (context.composing) return null;
  if (key.name === "return" || key.name === "enter") {
    if (!context.isOwner) return READ_ONLY;

    return context.resolved ? null : { type: "openSubmit" };
  }

  return (
    (context.isDiff && resolveDiffChord(key.name, context)) || resolveRailChord(key.name, context)
  );
}

export function dispatchLeaderCommand(
  key: { name: string; shift?: boolean },
  context: ThreadChordContext,
  dispatch: (intent: Intent) => void,
): void {
  const name = key.shift ? key.name.toUpperCase() : key.name;
  const chord = resolveLeaderCommand({ name }, context);

  if (chord) dispatch(chord);
}

/** The diff's row and file chords; null lets the rail chords answer the letter. */
function resolveDiffChord(name: string, context: ThreadChordContext): Intent | null {
  switch (name) {
    case "x":
      return mutating({ type: "rejectChange" }, context);
    case "X":
      return mutating({ type: "rejectHunk" }, context);
    case "c":
      return { type: "foldFile" };
    case "d":
      return { type: "toggleDiffView" };
    case "k":
      return context.resolved ? RESOLVED : { type: "walkStart" };
    default:
      return null;
  }
}

/** The answers a blocked primitive gets - the same words the keymap uses. */
const READ_ONLY: Intent = { type: "status", message: "observer - read-only" };
const RESOLVED: Intent = { type: "status", message: "review submitted - read-only" };

/** Editing, deleting, cutting, and restoring change the review: gated by role and by a verdict. */
function mutating(intent: Intent, context: ThreadChordContext): Intent {
  if (!context.isOwner) return READ_ONLY;
  if (context.resolved) return RESOLVED;

  return intent;
}

function resolveSessionChord(name: string, context: ThreadChordContext): Intent | null {
  switch (name) {
    case "e":
      return mutating({ type: "edit" }, context);
    case "s":
      return context.isOwner ? { type: "share" } : READ_ONLY;
    default:
      return null;
  }
}

// option arrives as meta in this terminal stack; the letters mirror the
// plan sheet's keymap so the rail keeps its muscle memory
function resolveRailChord(name: string, context: ThreadChordContext): Intent | null {
  switch (name) {
    case "n":
      return context.treeActive ? { type: "treeMove", direction: 1 } : { type: "nextAnnotation" };
    case "p":
      return context.treeActive ? { type: "treeMove", direction: -1 } : { type: "prevAnnotation" };
    case "t":
      return { type: "toggleTree" };
    // the tree is the owner's: a move, a branch, or a label changes what everyone sees
    case "g":
      return mutating({ type: "treeGo" }, context);
    case "b":
      return mutating({ type: "treeBranch" }, context);
    case "l":
      return mutating({ type: "treeLabel" }, context);
    // a fork can be taken from a resolved review: only the role gates it
    case "f":
      return context.isOwner ? { type: "treeFork" } : READ_ONLY;
    case "h":
      return context.isOwner ? { type: "treeForkShare" } : READ_ONLY;
    case "e":
      return mutating({ type: "editCard" }, context);
    case "backspace":
      return mutating({ type: "removeAnnotation" }, context);
    // renaming an author is a local display choice, open to every role
    case "r":
      return { type: "openRename" };
    case "x":
      return mutating({ type: "cut" }, context);
    case "u":
      return mutating({ type: "restoreCuration" }, context);
    default:
      return null;
  }
}
