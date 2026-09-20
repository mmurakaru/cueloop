/**
 * The thread view's command keys. Typing in the thread composes a comment, so
 * the structural commands live in a nav mode: press esc to leave the composer,
 * then a bare letter acts on the session, the discussion under the caret, the
 * tree, or a diff row. Bare letters are chosen so no terminal multiplexer or OS
 * shortcut can intercept them - there is no modifier chord and no leader.
 * Pure: this maps a nav key to an intent or to null (which returns to typing).
 */

import type { Intent } from "./keymap";

export interface NavKey {
  name: string;
  shift?: boolean;
}

export interface ThreadNavContext {
  /** Collaborators annotate only; submit, edit, and share are the owner's. */
  isOwner: boolean;
  /** A resolved session has nothing left to submit. */
  resolved: boolean;
  /** The tree is showing: n / p move its selection instead of cycling cards. */
  treeActive: boolean;
  /** A diff review: the row chords act on the code row under the caret (reject, fold, walk). */
  isDiff?: boolean;
}

export interface ChordEntry {
  keys: string;
  label: string;
}

/** The session commands: submit, edit, and share, all owner-only. */
export function sessionCommandEntries(): ChordEntry[] {
  return [
    { keys: "⏎", label: "submit the review" },
    { keys: "e", label: "edit in $EDITOR" },
    { keys: "s", label: "share" },
  ];
}

/** The diff-review commands, on the caret's row or file. */
export function diffCommandEntries(): ChordEntry[] {
  return [
    { keys: "x / X", label: "reject the change / the hunk" },
    { keys: "u", label: "restore the last rejection" },
    { keys: "c", label: "collapse the file to its band" },
    { keys: "d", label: "split / stacked (when wide)" },
    { keys: "k", label: "start the guided walk" },
  ];
}

/** The discussion and curation commands, on the discussion under the caret. */
export function curationCommandEntries(): ChordEntry[] {
  return [
    { keys: "n / p", label: "next / previous card" },
    { keys: "⌫", label: "delete the card" },
    { keys: "r", label: "rename the author" },
    { keys: "x", label: "cut the block" },
    { keys: "u", label: "restore the last cut" },
  ];
}

/** The tree commands, on the session's history tree. */
export function treeCommandEntries(): ChordEntry[] {
  return [
    { keys: "t", label: "show / hide the tree" },
    { keys: "n / p", label: "next / previous entry" },
    { keys: "g", label: "go to the entry" },
    { keys: "b", label: "branch off the tip" },
    { keys: "l", label: "label a checkpoint" },
    { keys: "f", label: "fork the path" },
    { keys: "h", label: "fork and hand off" },
  ];
}

/** The answers a blocked primitive gets - the same words the keymap uses. */
const READ_ONLY: Intent = { type: "status", message: "observer - read-only" };
const RESOLVED: Intent = { type: "status", message: "review submitted - read-only" };

/** Editing, deleting, cutting, and restoring change the review: gated by role and by a verdict. */
function mutating(intent: Intent, context: ThreadNavContext): Intent {
  if (!context.isOwner) return READ_ONLY;
  if (context.resolved) return RESOLVED;

  return intent;
}

/** The diff's row and file commands; null lets the curation commands answer the letter. */
function resolveDiffKey(name: string, context: ThreadNavContext): Intent | null {
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

/** The session commands: edit the plan in $EDITOR, share the plan. */
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

/**
 * The discussion, curation, and tree commands. n / p cycle the discussion cards,
 * or move the tree selection while the tree shows. The tree moves are the
 * owner's; renaming an author is open to every role.
 */
function resolveCurationKey(name: string, context: ThreadNavContext): Intent | null {
  switch (name) {
    case "n":
      return context.treeActive ? { type: "treeMove", direction: 1 } : { type: "nextAnnotation" };
    case "p":
      return context.treeActive ? { type: "treeMove", direction: -1 } : { type: "prevAnnotation" };
    case "t":
      return { type: "toggleTree" };
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

/**
 * The session's Ctrl chords, reachable from the thread without nav mode - the
 * same commands nav mode offers on bare keys, kept as reliable, conventional
 * accelerators (terminals deliver Ctrl and cmd chords without a multiplexer
 * clash). cmd/ctrl+enter opens the submit card; ctrl+e edits; ctrl+s shares.
 */
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

/**
 * Resolve one nav-mode key to a thread command, or null when no command claims
 * it (the caller then returns to composing). enter submits; a diff row's keys
 * win over the shared letters; the session and curation commands answer the rest.
 */
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
