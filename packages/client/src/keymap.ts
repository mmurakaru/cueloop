/**
 * The keyboard grammar as a pure reducer: view state in, intents out.
 * App builds a KeyState per key event, calls reduceKey, and dispatches the
 * intents to controller verbs and view-state setters - no branch bodies live
 * in the key handler. Diff and plan reviews share one path for annotation
 * navigation, deletion, and submit; the read-only rule is one gate here.
 */

import { actionFor } from "./config";

export type Intent =
  | { type: "exit" }
  | { type: "status"; message: string }
  | { type: "move"; to: "down" | "up" | "top" | "bottom" }
  | { type: "inboxMove"; to: "down" | "up" }
  | { type: "openSession" }
  | { type: "startSpan" }
  | { type: "spanKey"; name: string }
  | { type: "openCompose"; kind: "comment" | "suggestion"; from: "cursor" | "span" }
  | { type: "openSubmit" }
  | { type: "cut" }
  | { type: "edit" }
  | { type: "editCard" }
  | { type: "nextAnnotation" }
  | { type: "prevAnnotation" }
  | { type: "walkStart" }
  | { type: "walkForward" }
  | { type: "walkBack" }
  | { type: "walkLeave" }
  | { type: "removeAnnotation" }
  | { type: "deselect" }
  | { type: "closeOverlay" }
  | { type: "saveCompose" }
  | { type: "submitVerdict" }
  | { type: "cycleVerdict"; dir: -1 | 1 }
  | { type: "finishReview" }
  | { type: "optInAutoClose" }
  | { type: "dismissCompletion" };

export interface KeyInput {
  name: string;
  shift: boolean;
}

export interface KeyState {
  /** Loaded keymap (config.ts): action -> key combos. */
  keys: Record<string, string[]>;
  readOnly: boolean;
  /** Layer that owns keys before the grammar runs. */
  overlay: "none" | "walk" | "compose" | "submit" | "completion-prompt" | "completion-counting";
  view: "inbox" | "plan" | "diff";
  /** Plan-only span selection sub-mode. */
  spanMode: boolean;
  /** The walk cursor sits on the end card - return offers the submit action. */
  walkAtEnd: boolean;
  resolved: boolean;
  hasInboxItems: boolean;
  annotationCount: number;
  hasFocusedAnnotation: boolean;
  /** Cursor sits on annotatable text: a work block (plan) or a code row (diff). */
  cursorAnnotatable: boolean;
}

/** Verbs that write session state; an observer never reaches their handlers. */
const MUTATING_ACTIONS = new Set(["comment", "suggest", "cut", "edit", "delete_annotation", "submit", "walk"]);

const SPAN_KEYS = ["l", "h", "w", "b", "$", "0"];

function status(message: string): Intent[] {
  return [{ type: "status", message }];
}

/**
 * Reduce one key event to intents. `resolvedAction` is the binding-layer
 * resolution (key-bindings.ts over @opentui/keymap) when the caller has one;
 * without it the reducer falls back to the plain reverse lookup, so the
 * grammar stays testable as a pure function.
 */
export function reduceKey(state: KeyState, key: KeyInput, resolvedAction?: string): Intent[] {
  const name = key.name;
  // compose/submit overlays own the keys via focused inputs; only escape,
  // return, and verdict arrows route through the grammar
  if (state.overlay === "compose" || state.overlay === "submit") {
    if (name === "escape") return [{ type: "closeOverlay" }];
    if (name === "return" || name === "enter") {
      return [state.overlay === "compose" ? { type: "saveCompose" } : { type: "submitVerdict" }];
    }
    if (state.overlay === "submit" && (name === "left" || name === "right")) {
      return [{ type: "cycleVerdict", dir: name === "left" ? -1 : 1 }];
    }
    return [];
  }
  if (state.overlay === "completion-prompt" || state.overlay === "completion-counting") {
    if (name === "return" || name === "enter" || name === "q") return [{ type: "finishReview" }];
    if (name === "a") return [{ type: "optInAutoClose" }];
    if (name === "escape") return [{ type: "dismissCompletion" }];
    return [];
  }
  // the walk wizard owns its keys while active: ] advances (marking the
  // current file viewed), [ steps back, escape leaves keeping progress, and
  // return on the end card hands over to the submit confirm
  if (state.overlay === "walk") {
    if (name === "]") return [{ type: "walkForward" }];
    if (name === "[") return [{ type: "walkBack" }];
    if (name === "escape") return [{ type: "walkLeave" }];
    if ((name === "return" || name === "enter") && state.walkAtEnd) {
      return [{ type: "walkLeave" }, { type: "openSubmit" }];
    }
    if (name === "q") return [{ type: "exit" }];
    return [];
  }
  const action = resolvedAction ?? actionFor(state.keys, name, key.shift);
  if (action === "quit") return [{ type: "exit" }];
  // the ONE read-only rule: any mutating attempt answers instead of acting
  // (span-mode c/s are hardwired keys, so they gate by name as well)
  const mutating = MUTATING_ACTIONS.has(action ?? "") || (state.spanMode && (name === "c" || name === "s"));
  if (state.readOnly && mutating) return status("observer - read-only");

  if (state.view === "inbox") return inboxGrammar(state, name);
  if (state.view === "diff") return diffGrammar(state, action);
  if (state.spanMode) return spanGrammar(name);
  return planGrammar(state, action, name);
}

function inboxGrammar(state: KeyState, name: string): Intent[] {
  if (!state.hasInboxItems) return [];
  if (name === "j" || name === "down") return [{ type: "inboxMove", to: "down" }];
  if (name === "k" || name === "up") return [{ type: "inboxMove", to: "up" }];
  if (name === "return" || name === "enter") return [{ type: "openSession" }];
  return [];
}

function diffGrammar(state: KeyState, action: string | undefined): Intent[] {
  const navigation = navigationIntent(action);
  if (navigation) return navigation;
  if (action === "walk") {
    // marking viewed writes the session record, so a resolved review answers
    if (state.resolved) return status("review submitted - read-only");
    return [{ type: "walkStart" }];
  }
  if (action === "comment") {
    if (state.resolved) return status("review submitted - read-only");
    if (!state.cursorAnnotatable) return status("move to a code line to comment");
    return [{ type: "openCompose", kind: "comment", from: "cursor" }];
  }
  const shared = annotationCluster(state, action);
  if (shared) return shared;
  if (action === "span" || action === "cut" || action === "edit" || action === "suggest") {
    return status("plan-only verb - diff review uses c on a line");
  }
  return [];
}

function spanGrammar(name: string): Intent[] {
  if (name === "escape") return [{ type: "closeOverlay" }];
  if (SPAN_KEYS.includes(name)) return [{ type: "spanKey", name }];
  if (name === "c" || name === "s") {
    return [{ type: "openCompose", kind: name === "s" ? "suggestion" : "comment", from: "span" }];
  }
  return [];
}

function planGrammar(state: KeyState, action: string | undefined, name: string): Intent[] {
  const navigation = navigationIntent(action);
  if (navigation) return navigation;
  if (action === "walk") return status("the guided walk is a diff-review mode");
  if (name === "escape") return [{ type: "deselect" }];
  if (action === "span") return state.cursorAnnotatable ? [{ type: "startSpan" }] : [];
  if (action === "comment" || action === "suggest") {
    if (state.resolved) return status("review submitted - read-only");
    if (!state.cursorAnnotatable) return status("text is cut - restore it first");
    return [{ type: "openCompose", kind: action === "suggest" ? "suggestion" : "comment", from: "cursor" }];
  }
  if (action === "cut" || action === "edit") {
    if (state.resolved) return status("review submitted - read-only");
    // the document selects, the rail edits: with a card selected, Cut deletes
    // the annotation and edit rewrites the card body in place
    if (state.hasFocusedAnnotation) return [action === "cut" ? { type: "removeAnnotation" } : { type: "editCard" }];
    return [{ type: action }];
  }
  return annotationCluster(state, action) ?? [];
}

/** Cursor movement is the same intent everywhere; views clamp their own bounds. */
function navigationIntent(action: string | undefined): Intent[] | null {
  if (action === "down" || action === "up" || action === "top" || action === "bottom") {
    return [{ type: "move", to: action }];
  }
  return null;
}

/** Annotation navigation, deletion, and submit: one path for plan and diff. */
function annotationCluster(state: KeyState, action: string | undefined): Intent[] | null {
  if (action === "next_annotation" || action === "prev_annotation") {
    if (!state.annotationCount) return status("no annotations");
    return [{ type: action === "next_annotation" ? "nextAnnotation" : "prevAnnotation" }];
  }
  if (action === "delete_annotation") {
    if (state.resolved || !state.hasFocusedAnnotation) return [];
    return [{ type: "removeAnnotation" }];
  }
  if (action === "submit") return state.resolved ? [] : [{ type: "openSubmit" }];
  return null;
}
