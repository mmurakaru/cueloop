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
}

/** The cheatsheet rows for the chords, in the same order they are resolved. */
export const THREAD_CHORD_ENTRIES = [
  { keys: "⌃enter", label: "submit the review" },
  { keys: "⌃e", label: "edit in $EDITOR" },
  { keys: "⌃s", label: "share" },
  { keys: "⌃r", label: "cycle the rail" },
] as const;

/** The rail and curation chords: option (alt) plus the plan sheet's old letter. */
export const RAIL_CHORD_ENTRIES = [
  { keys: "⌥n / ⌥p", label: "next / previous card" },
  { keys: "⌥e", label: "edit the card" },
  { keys: "⌥⌫", label: "delete the card" },
  { keys: "⌥r", label: "rename the author" },
  { keys: "⌥x", label: "cut the block" },
  { keys: "⌥u", label: "restore the last cut" },
  { keys: "⌥w / ⌥s", label: "widen / narrow the rail" },
] as const;

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
  if (key.meta) return resolveRailChord(key.name, context);

  return null;
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
    case "r":
      return { type: "cycleReviewPanel" };
    default:
      return null;
  }
}

// option arrives as meta in this terminal stack; the letters mirror the
// plan sheet's keymap so the rail keeps its muscle memory
function resolveRailChord(name: string, context: ThreadChordContext): Intent | null {
  switch (name) {
    case "n":
      return { type: "nextAnnotation" };
    case "p":
      return { type: "prevAnnotation" };
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
    // letters only: escape-prefixed punctuation reads as control sequences, not keys
    case "w":
      return { type: "resizeReviewPanel", direction: 1 };
    case "s":
      return { type: "resizeReviewPanel", direction: -1 };
    default:
      return null;
  }
}
