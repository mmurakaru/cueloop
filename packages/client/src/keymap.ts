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
  | { type: "requestDeleteSession" }
  | { type: "openRename" }
  | { type: "confirmDialog" }
  | { type: "startSpan" }
  | { type: "spanKey"; name: string }
  | { type: "spanCut" }
  | { type: "openSpanActions" }
  | { type: "moveSpanAction"; direction: -1 | 1 }
  | { type: "pickSpanAction"; index?: number }
  | { type: "closeSpanActions" }
  | { type: "openCompose"; kind: "comment"; from: "cursor" | "span" }
  | { type: "openSubmit" }
  | { type: "share" }
  | { type: "cut" }
  | { type: "edit" }
  | { type: "editCard" }
  | { type: "rejectHunk" }
  | { type: "rejectChange" }
  | { type: "restoreCuration" }
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
  | { type: "cycleVerdict"; direction: -1 | 1 }
  | { type: "finishReview" }
  | { type: "optInAutoClose" }
  | { type: "dismissCompletion" }
  | { type: "cycleReviewPanel" }
  | { type: "resizeReviewPanel"; direction: -1 | 1 };

export interface KeyInput {
  name: string;
  shift: boolean;
  /** Option/Alt arrives as `meta` in this terminal stack (never as a raw alt). */
  meta?: boolean;
}

export interface KeyState {
  /** Loaded keymap (config.ts): action -> key combos. */
  keys: Record<string, string[]>;
  readOnly: boolean;
  /**
   * Owner-only verbs a share collaborator lacks (undefined = owner, allowed).
   * A collaborator annotates but cannot edit the plan (cut / $EDITOR runs on
   * the gateway) or submit an agent verdict (there is no agent on a share).
   */
  canEditPlan?: boolean;
  canSubmitVerdict?: boolean;
  /** Owner-only: publish the plan as a share. A collaborator never re-shares. */
  canShare?: boolean;
  /** Layer that owns keys before the grammar runs. */
  overlay:
    | "none"
    | "walk"
    | "compose"
    | "submit"
    | "confirm"
    | "prompt"
    | "spanActions"
    | "completion-prompt"
    | "completion-counting";
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
const MUTATING_ACTIONS = new Set([
  "comment",
  "cut",
  "edit",
  "delete_annotation",
  "submit",
  "walk",
  "share",
  "reject_hunk",
  "restore_curation",
]);

const SPAN_KEYS = new Set(["l", "h", "w", "b", "$", "0"]);

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
      // In the composer, ⌥/Alt+⏎ (meta) and shift+⏎ insert a newline - the
      // focused textarea owns that; only a bare ⏎ saves. The submit overlay
      // keeps its plain ⏎ submit.
      if (state.overlay === "compose") {
        if (key.shift || key.meta) return [];
        return [{ type: "saveCompose" }];
      }
      return [{ type: "submitVerdict" }];
    }
    if (state.overlay === "submit" && (name === "left" || name === "right")) {
      return [{ type: "cycleVerdict", direction: name === "left" ? -1 : 1 }];
    }
    return [];
  }
  // a modal confirm owns the keys: ⏎ commits the action, escape backs out
  if (state.overlay === "confirm") {
    if (name === "return" || name === "enter") return [{ type: "confirmDialog" }];
    if (name === "escape") return [{ type: "closeOverlay" }];
    return [];
  }
  // a text prompt: the focused input owns typing; only ⏎ save and esc route here
  if (state.overlay === "prompt") {
    if (name === "return" || name === "enter") return [{ type: "confirmDialog" }];
    if (name === "escape") return [{ type: "closeOverlay" }];
    return [];
  }
  // the quick-actions list owns its keys: j/k move, ⏎ picks the highlighted
  // action (inserting its preset comment), escape returns to the span toolbar
  if (state.overlay === "spanActions") {
    if (name === "j" || name === "down") return [{ type: "moveSpanAction", direction: 1 }];
    if (name === "k" || name === "up") return [{ type: "moveSpanAction", direction: -1 }];
    if (name === "return" || name === "enter") return [{ type: "pickSpanAction" }];
    if (name === "escape") return [{ type: "closeSpanActions" }];
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
  // (span-mode c and a are hardwired keys, so they gate by name as well)
  const mutating =
    MUTATING_ACTIONS.has(action ?? "") || (state.spanMode && (name === "c" || name === "a"));
  if (state.readOnly && mutating) return status("observer - read-only");

  // share is a session-level verb: it works from any view, owner only
  if (action === "share") {
    if (state.canShare === false) return status("only the plan owner can share");
    return [{ type: "share" }];
  }

  if (state.view === "inbox") return inboxGrammar(state, name);
  // span mode owns its single-letter keys (b slides the span back) before the
  // review-panel controls claim them
  if (state.spanMode) return spanGrammar(name);
  // the review panel rides both plan and diff reviews; collapsing and resizing
  // are view state, so the read-only gate above lets them through
  const reviewPanel = reviewPanelGrammar(action);
  if (reviewPanel) return reviewPanel;
  if (state.view === "diff") return diffGrammar(state, action);
  return planGrammar(state, action, name);
}

/** The review-panel controls: cycle the mode, widen and narrow the rail. */
function reviewPanelGrammar(action: string | undefined): Intent[] | null {
  if (action === "review_cycle") return [{ type: "cycleReviewPanel" }];
  if (action === "review_wider") return [{ type: "resizeReviewPanel", direction: 1 }];
  if (action === "review_narrower") return [{ type: "resizeReviewPanel", direction: -1 }];
  return null;
}

function inboxGrammar(state: KeyState, name: string): Intent[] {
  if (!state.hasInboxItems) return [];
  if (name === "j" || name === "down") return [{ type: "inboxMove", to: "down" }];
  if (name === "k" || name === "up") return [{ type: "inboxMove", to: "up" }];
  if (name === "return" || name === "enter") return [{ type: "openSession" }];
  if (name === "d") return [{ type: "requestDeleteSession" }];
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
  // cut rejects the change under the cursor, reject_hunk the whole hunk; both
  // write the working copy, so they gate on owner like a plan edit.
  if (action === "cut" || action === "reject_hunk") {
    if (state.resolved) return status("review submitted - read-only");
    if (state.canEditPlan === false) return status("only the diff owner can curate hunks");
    return [{ type: action === "reject_hunk" ? "rejectHunk" : "rejectChange" }];
  }
  // restore un-does a curated-out rejection from the rail; same owner gate as reject
  if (action === "restore_curation") {
    if (state.resolved) return status("review submitted - read-only");
    if (state.canEditPlan === false) return status("only the diff owner can curate hunks");
    return [{ type: "restoreCuration" }];
  }
  const shared = annotationCluster(state, action);
  if (shared) return shared;
  if (action === "span" || action === "edit") {
    return status("plan-only verb - diff review uses c on a line");
  }
  return [];
}

function spanGrammar(name: string): Intent[] {
  if (name === "escape") return [{ type: "closeOverlay" }];
  if (SPAN_KEYS.has(name)) return [{ type: "spanKey", name }];
  if (name === "c") {
    return [{ type: "openCompose", kind: "comment", from: "span" }];
  }
  // partial-span cut is not in the working-copy model, so cut removes the whole
  // block the span sits in
  if (name === "x") return [{ type: "spanCut" }];
  if (name === "a") return [{ type: "openSpanActions" }];
  return [];
}

function planGrammar(state: KeyState, action: string | undefined, name: string): Intent[] {
  const navigation = navigationIntent(action);
  if (navigation) return navigation;
  if (action === "walk") return status("the guided walk is a diff-review mode");
  if (name === "escape") return [{ type: "deselect" }];
  if (action === "span") return state.cursorAnnotatable ? [{ type: "startSpan" }] : [];
  if (action === "comment") {
    if (state.resolved) return status("review submitted - read-only");
    if (!state.cursorAnnotatable) return status("text is cut - restore it first");
    return [{ type: "openCompose", kind: "comment", from: "cursor" }];
  }
  // restore un-does a rail removal (a cut block); a plan edit, so owner-only
  if (action === "restore_curation") {
    if (state.resolved) return status("review submitted - read-only");
    if (state.canEditPlan === false) return [];
    return [{ type: "restoreCuration" }];
  }
  if (action === "cut" || action === "edit") {
    if (state.resolved) return status("review submitted - read-only");
    // the document selects, the rail edits: with a card selected, Cut deletes
    // the annotation and edit rewrites the card body in place
    if (state.hasFocusedAnnotation)
      return [action === "cut" ? { type: "removeAnnotation" } : { type: "editCard" }];
    // editing the plan itself is the owner's verb; a share viewer only annotates,
    // and has no edit affordance, so the key is silent rather than a nag
    if (state.canEditPlan === false) return [];
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
  if (action === "rename") {
    if (!state.hasFocusedAnnotation) return status("select a collaborator's note to rename them");
    return [{ type: "openRename" }];
  }
  if (action === "submit") {
    // a collaborator's notes union back as they go; there is no verdict to submit
    if (state.canSubmitVerdict === false)
      return status("shared view - your notes save as you go; q to leave");
    return state.resolved ? [] : [{ type: "openSubmit" }];
  }
  return null;
}
