import type { Intent } from "./keymap";

export interface NavKey {
  name: string;
  shift?: boolean;
}

export interface ThreadNavContext {
  isOwner: boolean;
  resolved: boolean;
  treeActive: boolean;
  isDiff?: boolean;
}

export interface ChordEntry {
  keys: string;
  label: string;
}

export function sessionCommandEntries(): ChordEntry[] {
  return [
    { keys: "⏎", label: "submit the review" },
    { keys: "e", label: "edit in $EDITOR" },
    { keys: "s", label: "share" },
  ];
}

export function diffCommandEntries(): ChordEntry[] {
  return [
    { keys: "x", label: "reject the change under the caret" },
    { keys: "u", label: "restore the last rejection" },
    { keys: "c", label: "collapse the file to its band" },
    { keys: "d", label: "split / stacked (when wide)" },
    { keys: "k", label: "start the guided walk" },
  ];
}

export function curationCommandEntries(): ChordEntry[] {
  return [
    { keys: "n / p", label: "next / previous card" },
    { keys: "z", label: "fold / unfold the card" },
    { keys: "⌫", label: "delete the card" },
    { keys: "r", label: "rename the author" },
    { keys: "x", label: "cut the block" },
    { keys: "u", label: "restore the last cut" },
  ];
}

export function treeCommandEntries(): ChordEntry[] {
  return [
    { keys: "g", label: "go to the entry" },
    { keys: "b", label: "branch off the tip" },
    { keys: "l", label: "label a checkpoint" },
    { keys: "f", label: "fork the path" },
    { keys: "h", label: "fork and hand off" },
  ];
}

const READ_ONLY: Intent = { type: "status", message: "observer - read-only" };
const RESOLVED: Intent = { type: "status", message: "review submitted - read-only" };

function mutating(intent: Intent, context: ThreadNavContext): Intent {
  if (!context.isOwner) return READ_ONLY;
  if (context.resolved) return RESOLVED;

  return intent;
}

function resolveDiffKey(name: string, context: ThreadNavContext): Intent | null {
  switch (name) {
    case "x":
      return mutating({ type: "rejectChange" }, context);
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

function resolveSessionKey(name: string, context: ThreadNavContext): Intent | null {
  switch (name) {
    case "e":
      return mutating({ type: "edit" }, context);
    case "s":
      return context.isOwner ? { type: "share" } : READ_ONLY;
    default:
      return null;
  }
}

function resolveCurationKey(name: string, context: ThreadNavContext): Intent | null {
  switch (name) {
    case "n":
      return context.treeActive ? { type: "treeMove", direction: 1 } : { type: "nextAnnotation" };
    case "p":
      return context.treeActive ? { type: "treeMove", direction: -1 } : { type: "prevAnnotation" };
    case "g":
      return mutating({ type: "treeGo" }, context);
    case "b":
      return mutating({ type: "treeBranch" }, context);
    case "l":
      return mutating({ type: "treeLabel" }, context);
    case "f":
      return context.isOwner ? { type: "treeFork" } : READ_ONLY;
    case "h":
      return context.isOwner ? { type: "treeForkShare" } : READ_ONLY;
    case "backspace":
      return mutating({ type: "removeAnnotation" }, context);
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

export interface SessionChordKey {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  super?: boolean;
}

export function resolveSessionChord(
  key: SessionChordKey,
  context: Pick<ThreadNavContext, "isOwner" | "resolved">,
): Intent | null {
  if (key.name === "return" || key.name === "enter") {
    if (!(key.ctrl || key.meta || key.super)) return null;
    if (!context.isOwner) return READ_ONLY;

    return context.resolved ? null : { type: "openSubmit" };
  }
  if (!key.ctrl) return null;
  if (key.name === "e")
    return context.resolved ? RESOLVED : context.isOwner ? { type: "edit" } : READ_ONLY;
  if (key.name === "s") return context.isOwner ? { type: "share" } : READ_ONLY;

  return null;
}

export function resolveNavKey(key: NavKey, context: ThreadNavContext): Intent | null {
  const name = key.shift ? key.name.toUpperCase() : key.name;

  if (name === "return" || name === "enter") {
    if (!context.isOwner) return READ_ONLY;

    return context.resolved ? null : { type: "openSubmit" };
  }

  return (
    (context.isDiff ? resolveDiffKey(name, context) : null) ??
    resolveSessionKey(name, context) ??
    resolveCurationKey(name, context)
  );
}
