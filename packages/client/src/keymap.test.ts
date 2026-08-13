/**
 * The keyboard grammar as data: every mode x key produces a known intent
 * list, the read-only rule is one gate, and plan and diff reviews share one
 * path for annotation navigation, deletion, and submit.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_KEYS } from "./config";
import { reduceKey, type Intent, type KeyState } from "./keymap";

function state(patch: Partial<KeyState> = {}): KeyState {
  return {
    keys: DEFAULT_KEYS,
    readOnly: false,
    overlay: "none",
    view: "plan",
    spanMode: false,
    resolved: false,
    hasInboxItems: true,
    annotationCount: 1,
    hasFocusedAnnotation: true,
    cursorAnnotatable: true,
    walkAtEnd: false,
    ...patch,
  };
}

function key(name: string, shift = false, meta = false): { name: string; shift: boolean; meta: boolean } {
  return { name, shift, meta };
}

describe("compose overlay", () => {
  const keyState = state({ overlay: "compose" });
  const table: [string, Intent[]][] = [
    ["escape", [{ type: "closeOverlay" }]],
    ["return", [{ type: "saveCompose" }]],
    ["enter", [{ type: "saveCompose" }]],
    ["left", []],
    ["right", []],
    ["j", []],
    ["q", []],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(keyState, key(name))).toEqual(expected);
    });
  }

  // ⌥/Alt+⏎ (meta) and shift+⏎ insert a newline in the composer, so the
  // grammar must not save on them; only a bare ⏎ saves.
  test("option/alt+return (meta) does not save - the textarea inserts a newline", () => {
    expect(reduceKey(keyState, key("return", false, true))).toEqual([]);
  });
  test("shift+return does not save - the textarea inserts a newline", () => {
    expect(reduceKey(keyState, key("return", true, false))).toEqual([]);
  });
});

describe("submit overlay", () => {
  const keyState = state({ overlay: "submit" });
  const table: [string, Intent[]][] = [
    ["escape", [{ type: "closeOverlay" }]],
    ["return", [{ type: "submitVerdict" }]],
    ["enter", [{ type: "submitVerdict" }]],
    ["left", [{ type: "cycleVerdict", dir: -1 }]],
    ["right", [{ type: "cycleVerdict", dir: 1 }]],
    ["j", []],
    ["q", []],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(keyState, key(name))).toEqual(expected);
    });
  }
});

describe("completion overlay", () => {
  const prompt = state({ overlay: "completion-prompt" });
  const counting = state({ overlay: "completion-counting" });
  const table: [KeyState, string, Intent[]][] = [
    [prompt, "return", [{ type: "finishReview" }]],
    [prompt, "enter", [{ type: "finishReview" }]],
    [prompt, "q", [{ type: "finishReview" }]],
    [prompt, "a", [{ type: "optInAutoClose" }]],
    [prompt, "escape", [{ type: "dismissCompletion" }]],
    [prompt, "j", []],
    [counting, "return", [{ type: "finishReview" }]],
    [counting, "q", [{ type: "finishReview" }]],
    [counting, "a", [{ type: "optInAutoClose" }]],
    [counting, "escape", [{ type: "dismissCompletion" }]],
  ];
  for (const [overlayState, name, expected] of table) {
    test(`${overlayState.overlay} ${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(overlayState, key(name))).toEqual(expected);
    });
  }
});

describe("inbox mode", () => {
  const keyState = state({ view: "inbox" });
  const table: [string, Intent[]][] = [
    ["j", [{ type: "inboxMove", to: "down" }]],
    ["down", [{ type: "inboxMove", to: "down" }]],
    ["k", [{ type: "inboxMove", to: "up" }]],
    ["up", [{ type: "inboxMove", to: "up" }]],
    ["return", [{ type: "openSession" }]],
    ["enter", [{ type: "openSession" }]],
    ["q", [{ type: "exit" }]],
    ["c", []],
    ["escape", []],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(keyState, key(name))).toEqual(expected);
    });
  }

  test("an empty inbox swallows every non-quit key", () => {
    const empty = state({ view: "inbox", hasInboxItems: false });
    for (const name of ["j", "k", "down", "up", "return", "enter"]) {
      expect(reduceKey(empty, key(name))).toEqual([]);
    }
    expect(reduceKey(empty, key("q"))).toEqual([{ type: "exit" }]);
  });
});

describe("plan normal mode", () => {
  const keyState = state();
  const table: [string, boolean, Intent[]][] = [
    ["j", false, [{ type: "move", to: "down" }]],
    ["down", false, [{ type: "move", to: "down" }]],
    ["k", false, [{ type: "move", to: "up" }]],
    ["up", false, [{ type: "move", to: "up" }]],
    ["g", false, [{ type: "move", to: "top" }]],
    ["g", true, [{ type: "move", to: "bottom" }]],
    ["v", false, [{ type: "startSpan" }]],
    ["c", false, [{ type: "openCompose", kind: "comment", from: "cursor" }]],
    ["s", false, [{ type: "openCompose", kind: "suggestion", from: "cursor" }]],
    // the default state has a selected card, so Cut and edit act on the card
    ["x", false, [{ type: "removeAnnotation" }]],
    ["e", false, [{ type: "editCard" }]],
    ["n", false, [{ type: "nextAnnotation" }]],
    ["p", false, [{ type: "prevAnnotation" }]],
    ["backspace", false, [{ type: "removeAnnotation" }]],
    ["return", false, [{ type: "openSubmit" }]],
    ["q", false, [{ type: "exit" }]],
    ["escape", false, [{ type: "deselect" }]],
    ["z", false, []],
  ];
  for (const [name, shift, expected] of table) {
    test(`${shift ? "shift+" : ""}${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(keyState, key(name, shift))).toEqual(expected);
    });
  }

  test("resolved sessions guard the mutating verbs", () => {
    const resolvedState = state({ resolved: true });
    for (const name of ["c", "s", "x", "e"]) {
      expect(reduceKey(resolvedState, key(name))).toEqual([{ type: "status", message: "review submitted - read-only" }]);
    }
    expect(reduceKey(resolvedState, key("return"))).toEqual([]);
    expect(reduceKey(resolvedState, key("backspace"))).toEqual([]);
  });

  test("cut text cannot host a comment or a span", () => {
    const cut = state({ cursorAnnotatable: false });
    expect(reduceKey(cut, key("c"))).toEqual([{ type: "status", message: "text is cut - restore it first" }]);
    expect(reduceKey(cut, key("s"))).toEqual([{ type: "status", message: "text is cut - restore it first" }]);
    expect(reduceKey(cut, key("v"))).toEqual([]);
  });

  test("annotation navigation without annotations reports, delete without focus is silent", () => {
    const none = state({ annotationCount: 0, hasFocusedAnnotation: false });
    expect(reduceKey(none, key("n"))).toEqual([{ type: "status", message: "no annotations" }]);
    expect(reduceKey(none, key("p"))).toEqual([{ type: "status", message: "no annotations" }]);
    expect(reduceKey(none, key("backspace"))).toEqual([]);
  });

  test("without a selected card x cuts the block and e opens the editor", () => {
    const unfocused = state({ hasFocusedAnnotation: false });
    expect(reduceKey(unfocused, key("x"))).toEqual([{ type: "cut" }]);
    expect(reduceKey(unfocused, key("e"))).toEqual([{ type: "edit" }]);
  });
});

describe("span mode", () => {
  const keyState = state({ spanMode: true });
  const table: [string, Intent[]][] = [
    ["l", [{ type: "spanKey", name: "l" }]],
    ["h", [{ type: "spanKey", name: "h" }]],
    ["w", [{ type: "spanKey", name: "w" }]],
    ["b", [{ type: "spanKey", name: "b" }]],
    ["$", [{ type: "spanKey", name: "$" }]],
    ["0", [{ type: "spanKey", name: "0" }]],
    ["c", [{ type: "openCompose", kind: "comment", from: "span" }]],
    ["s", [{ type: "openCompose", kind: "suggestion", from: "span" }]],
    ["escape", [{ type: "closeOverlay" }]],
    ["q", [{ type: "exit" }]],
    ["j", []],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(keyState, key(name))).toEqual(expected);
    });
  }
});

describe("diff mode", () => {
  const keyState = state({ view: "diff" });
  const table: [string, Intent[]][] = [
    ["j", [{ type: "move", to: "down" }]],
    ["k", [{ type: "move", to: "up" }]],
    ["g", [{ type: "move", to: "top" }]],
    ["c", [{ type: "openCompose", kind: "comment", from: "cursor" }]],
    ["n", [{ type: "nextAnnotation" }]],
    ["p", [{ type: "prevAnnotation" }]],
    ["backspace", [{ type: "removeAnnotation" }]],
    ["return", [{ type: "openSubmit" }]],
    ["v", [{ type: "status", message: "plan-only verb - diff review uses c on a line" }]],
    ["x", [{ type: "status", message: "plan-only verb - diff review uses c on a line" }]],
    ["e", [{ type: "status", message: "plan-only verb - diff review uses c on a line" }]],
    ["s", [{ type: "status", message: "plan-only verb - diff review uses c on a line" }]],
    ["q", [{ type: "exit" }]],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(keyState, key(name))).toEqual(expected);
    });
  }

  test("comment guards: resolved first, then non-code rows", () => {
    expect(reduceKey(state({ view: "diff", resolved: true }), key("c"))).toEqual([
      { type: "status", message: "review submitted - read-only" },
    ]);
    expect(reduceKey(state({ view: "diff", cursorAnnotatable: false }), key("c"))).toEqual([
      { type: "status", message: "move to a code line to comment" },
    ]);
  });
});

describe("guided walk", () => {
  test("w enters the walk in diff view; resolved and read-only sessions answer", () => {
    expect(reduceKey(state({ view: "diff" }), key("w"))).toEqual([{ type: "walkStart" }]);
    expect(reduceKey(state({ view: "diff", resolved: true }), key("w"))).toEqual([
      { type: "status", message: "review submitted - read-only" },
    ]);
    expect(reduceKey(state({ view: "diff", readOnly: true }), key("w"))).toEqual([
      { type: "status", message: "observer - read-only" },
    ]);
    expect(reduceKey(state(), key("w"))).toEqual([{ type: "status", message: "the guided walk is a diff-review mode" }]);
  });

  const walking = state({ view: "diff", overlay: "walk" });
  const table: [string, Intent[]][] = [
    ["]", [{ type: "walkForward" }]],
    ["[", [{ type: "walkBack" }]],
    ["escape", [{ type: "walkLeave" }]],
    ["q", [{ type: "exit" }]],
    // mid-walk return does nothing: submit lives on the end card only
    ["return", []],
    ["j", []],
    ["c", []],
  ];
  for (const [name, expected] of table) {
    test(`walking ${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(walking, key(name))).toEqual(expected);
    });
  }

  test("the end card's return leaves the walk and opens the submit confirm", () => {
    const atEnd = state({ view: "diff", overlay: "walk", walkAtEnd: true });
    expect(reduceKey(atEnd, key("return"))).toEqual([{ type: "walkLeave" }, { type: "openSubmit" }]);
    expect(reduceKey(atEnd, key("enter"))).toEqual([{ type: "walkLeave" }, { type: "openSubmit" }]);
  });
});

describe("duplicated-branch collapse", () => {
  test("plan and diff produce the same intents for annotation nav, delete, and submit", () => {
    for (const patch of [
      {},
      { annotationCount: 0, hasFocusedAnnotation: false },
      { resolved: true },
    ] as Partial<KeyState>[]) {
      for (const name of ["n", "p", "backspace", "return"]) {
        const plan = reduceKey(state(patch), key(name));
        const diff = reduceKey(state({ ...patch, view: "diff" }), key(name));
        expect(diff).toEqual(plan);
      }
    }
  });
});

describe("read-only filter", () => {
  test("every mutating key answers observer - read-only, in plan and diff", () => {
    for (const view of ["plan", "diff"] as const) {
      const keyState = state({ view, readOnly: true });
      for (const name of ["c", "s", "x", "e", "backspace", "return", "enter"]) {
        expect(reduceKey(keyState, key(name))).toEqual([{ type: "status", message: "observer - read-only" }]);
      }
    }
  });

  test("navigation and annotation focus still work for observers", () => {
    const keyState = state({ readOnly: true });
    expect(reduceKey(keyState, key("j"))).toEqual([{ type: "move", to: "down" }]);
    expect(reduceKey(keyState, key("n"))).toEqual([{ type: "nextAnnotation" }]);
    expect(reduceKey(keyState, key("q"))).toEqual([{ type: "exit" }]);
  });

  test("span-mode c/s are gated by key name even under a rebound keymap", () => {
    const rebound = { ...DEFAULT_KEYS, comment: ["m"], suggest: ["t"] };
    const keyState = state({ spanMode: true, readOnly: true, keys: rebound });
    expect(reduceKey(keyState, key("c"))).toEqual([{ type: "status", message: "observer - read-only" }]);
    expect(reduceKey(keyState, key("s"))).toEqual([{ type: "status", message: "observer - read-only" }]);
  });
});
