/**
 * The keyboard grammar as a pure reducer (#70): view state in, intents out.
 * App builds a KeyState per key event, calls reduceKey, and dispatches the
 * intents to controller verbs and view-state setters - no branch bodies live
 * in the key handler. Diff and plan reviews share one path for annotation
 * navigation, deletion, and submit; the read-only rule is one gate here.
 */

import { actionFor } from "./config";

export type Intent =
  | { t: "exit" }
  | { t: "status"; msg: string }
  | { t: "move"; to: "down" | "up" | "top" | "bottom" }
  | { t: "inboxMove"; to: "down" | "up" }
  | { t: "openSession" }
  | { t: "startSpan" }
  | { t: "spanKey"; name: string }
  | { t: "openCompose"; kind: "comment" | "suggestion"; from: "cursor" | "span" }
  | { t: "openSubmit" }
  | { t: "cut" }
  | { t: "edit" }
  | { t: "editCard" }
  | { t: "nextAnn" }
  | { t: "prevAnn" }
  | { t: "removeAnnotation" }
  | { t: "deselect" }
  | { t: "closeOverlay" }
  | { t: "saveCompose" }
  | { t: "submitVerdict" }
  | { t: "cycleVerdict"; dir: -1 | 1 }
  | { t: "finishReview" }
  | { t: "optInAutoClose" }
  | { t: "dismissCompletion" };

export interface KeyInput {
  name: string;
  shift: boolean;
}

export interface KeyState {
  /** Loaded keymap (config.ts): action -> key combos. */
  keys: Record<string, string[]>;
  readOnly: boolean;
  /** Layer that owns keys before the grammar runs. */
  overlay: "none" | "compose" | "submit" | "completion-prompt" | "completion-counting";
  view: "inbox" | "plan" | "diff";
  /** Plan-only span selection sub-mode. */
  spanMode: boolean;
  resolved: boolean;
  hasInboxItems: boolean;
  annotationCount: number;
  hasFocusedAnnotation: boolean;
  /** Cursor sits on annotatable text: a work block (plan) or a code row (diff). */
  cursorAnnotatable: boolean;
}

/** Verbs that write session state; an observer never reaches their handlers. */
const MUTATING_ACTIONS = new Set(["comment", "suggest", "cut", "edit", "delete_annotation", "submit"]);

const SPAN_KEYS = ["l", "h", "w", "b", "$", "0"];

function status(msg: string): Intent[] {
  return [{ t: "status", msg }];
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
    if (name === "escape") return [{ t: "closeOverlay" }];
    if (name === "return" || name === "enter") {
      return [state.overlay === "compose" ? { t: "saveCompose" } : { t: "submitVerdict" }];
    }
    if (state.overlay === "submit" && (name === "left" || name === "right")) {
      return [{ t: "cycleVerdict", dir: name === "left" ? -1 : 1 }];
    }
    return [];
  }
  if (state.overlay === "completion-prompt" || state.overlay === "completion-counting") {
    if (name === "return" || name === "enter" || name === "q") return [{ t: "finishReview" }];
    if (name === "a" && state.overlay === "completion-prompt") return [{ t: "optInAutoClose" }];
    if (name === "escape") return [{ t: "dismissCompletion" }];
    return [];
  }
  const action = resolvedAction ?? actionFor(state.keys, name, key.shift);
  if (action === "quit") return [{ t: "exit" }];
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
  if (name === "j" || name === "down") return [{ t: "inboxMove", to: "down" }];
  if (name === "k" || name === "up") return [{ t: "inboxMove", to: "up" }];
  if (name === "return" || name === "enter") return [{ t: "openSession" }];
  return [];
}

function diffGrammar(state: KeyState, action: string | undefined): Intent[] {
  const nav = navIntent(action);
  if (nav) return nav;
  if (action === "comment") {
    if (state.resolved) return status("review submitted - read-only");
    if (!state.cursorAnnotatable) return status("move to a code line to comment");
    return [{ t: "openCompose", kind: "comment", from: "cursor" }];
  }
  const shared = annotationCluster(state, action);
  if (shared) return shared;
  if (action === "span" || action === "cut" || action === "edit" || action === "suggest") {
    return status("plan-only verb - diff review uses c on a line");
  }
  return [];
}

function spanGrammar(name: string): Intent[] {
  if (name === "escape") return [{ t: "closeOverlay" }];
  if (SPAN_KEYS.includes(name)) return [{ t: "spanKey", name }];
  if (name === "c" || name === "s") {
    return [{ t: "openCompose", kind: name === "s" ? "suggestion" : "comment", from: "span" }];
  }
  return [];
}

function planGrammar(state: KeyState, action: string | undefined, name: string): Intent[] {
  const nav = navIntent(action);
  if (nav) return nav;
  if (name === "escape") return [{ t: "deselect" }];
  if (action === "span") return state.cursorAnnotatable ? [{ t: "startSpan" }] : [];
  if (action === "comment" || action === "suggest") {
    if (state.resolved) return status("review submitted - read-only");
    if (!state.cursorAnnotatable) return status("text is cut - restore it first");
    return [{ t: "openCompose", kind: action === "suggest" ? "suggestion" : "comment", from: "cursor" }];
  }
  if (action === "cut" || action === "edit") {
    if (state.resolved) return status("review submitted - read-only");
    // the document selects, the rail edits: with a card selected, Cut deletes
    // the annotation and edit rewrites the card body in place
    if (state.hasFocusedAnnotation) return [action === "cut" ? { t: "removeAnnotation" } : { t: "editCard" }];
    return [{ t: action }];
  }
  return annotationCluster(state, action) ?? [];
}

/** Cursor movement is the same intent everywhere; views clamp their own bounds. */
function navIntent(action: string | undefined): Intent[] | null {
  if (action === "down" || action === "up" || action === "top" || action === "bottom") {
    return [{ t: "move", to: action }];
  }
  return null;
}

/** Annotation navigation, deletion, and submit: one path for plan and diff. */
function annotationCluster(state: KeyState, action: string | undefined): Intent[] | null {
  if (action === "next_annotation" || action === "prev_annotation") {
    if (!state.annotationCount) return status("no annotations");
    return [{ t: action === "next_annotation" ? "nextAnn" : "prevAnn" }];
  }
  if (action === "delete_annotation") {
    if (state.resolved || !state.hasFocusedAnnotation) return [];
    return [{ t: "removeAnnotation" }];
  }
  if (action === "submit") return state.resolved ? [] : [{ t: "openSubmit" }];
  return null;
}
