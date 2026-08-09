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
    ...patch,
  };
}

function key(name: string, shift = false): { name: string; shift: boolean } {
  return { name, shift };
}

describe("compose overlay", () => {
  const s = state({ overlay: "compose" });
  const table: [string, Intent[]][] = [
    ["escape", [{ t: "closeOverlay" }]],
    ["return", [{ t: "saveCompose" }]],
    ["enter", [{ t: "saveCompose" }]],
    ["left", []],
    ["right", []],
    ["j", []],
    ["q", []],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(s, key(name))).toEqual(expected);
    });
  }
});

describe("submit overlay", () => {
  const s = state({ overlay: "submit" });
  const table: [string, Intent[]][] = [
    ["escape", [{ t: "closeOverlay" }]],
    ["return", [{ t: "submitVerdict" }]],
    ["enter", [{ t: "submitVerdict" }]],
    ["left", [{ t: "cycleVerdict", dir: -1 }]],
    ["right", [{ t: "cycleVerdict", dir: 1 }]],
    ["j", []],
    ["q", []],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(s, key(name))).toEqual(expected);
    });
  }
});

describe("completion overlay", () => {
  const prompt = state({ overlay: "completion-prompt" });
  const counting = state({ overlay: "completion-counting" });
  const table: [KeyState, string, Intent[]][] = [
    [prompt, "return", [{ t: "finishReview" }]],
    [prompt, "enter", [{ t: "finishReview" }]],
    [prompt, "q", [{ t: "finishReview" }]],
    [prompt, "a", [{ t: "optInAutoClose" }]],
    [prompt, "escape", [{ t: "dismissCompletion" }]],
    [prompt, "j", []],
    [counting, "return", [{ t: "finishReview" }]],
    [counting, "q", [{ t: "finishReview" }]],
    [counting, "a", [{ t: "optInAutoClose" }]],
    [counting, "escape", [{ t: "dismissCompletion" }]],
  ];
  for (const [s, name, expected] of table) {
    test(`${s.overlay} ${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(s, key(name))).toEqual(expected);
    });
  }
});

describe("inbox mode", () => {
  const s = state({ view: "inbox" });
  const table: [string, Intent[]][] = [
    ["j", [{ t: "inboxMove", to: "down" }]],
    ["down", [{ t: "inboxMove", to: "down" }]],
    ["k", [{ t: "inboxMove", to: "up" }]],
    ["up", [{ t: "inboxMove", to: "up" }]],
    ["return", [{ t: "openSession" }]],
    ["enter", [{ t: "openSession" }]],
    ["q", [{ t: "exit" }]],
    ["c", []],
    ["escape", []],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(s, key(name))).toEqual(expected);
    });
  }

  test("an empty inbox swallows every non-quit key", () => {
    const empty = state({ view: "inbox", hasInboxItems: false });
    for (const name of ["j", "k", "down", "up", "return", "enter"]) {
      expect(reduceKey(empty, key(name))).toEqual([]);
    }
    expect(reduceKey(empty, key("q"))).toEqual([{ t: "exit" }]);
  });
});

describe("plan normal mode", () => {
  const s = state();
  const table: [string, boolean, Intent[]][] = [
    ["j", false, [{ t: "move", to: "down" }]],
    ["down", false, [{ t: "move", to: "down" }]],
    ["k", false, [{ t: "move", to: "up" }]],
    ["up", false, [{ t: "move", to: "up" }]],
    ["g", false, [{ t: "move", to: "top" }]],
    ["g", true, [{ t: "move", to: "bottom" }]],
    ["v", false, [{ t: "startSpan" }]],
    ["c", false, [{ t: "openCompose", kind: "comment", from: "cursor" }]],
    ["s", false, [{ t: "openCompose", kind: "suggestion", from: "cursor" }]],
    // the default state has a selected card, so Cut and edit act on the card
    ["x", false, [{ t: "removeAnnotation" }]],
    ["e", false, [{ t: "editCard" }]],
    ["n", false, [{ t: "nextAnn" }]],
    ["p", false, [{ t: "prevAnn" }]],
    ["backspace", false, [{ t: "removeAnnotation" }]],
    ["return", false, [{ t: "openSubmit" }]],
    ["q", false, [{ t: "exit" }]],
    ["escape", false, [{ t: "deselect" }]],
    ["z", false, []],
  ];
  for (const [name, shift, expected] of table) {
    test(`${shift ? "shift+" : ""}${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(s, key(name, shift))).toEqual(expected);
    });
  }

  test("resolved sessions guard the mutating verbs", () => {
    const r = state({ resolved: true });
    for (const name of ["c", "s", "x", "e"]) {
      expect(reduceKey(r, key(name))).toEqual([{ t: "status", msg: "review submitted - read-only" }]);
    }
    expect(reduceKey(r, key("return"))).toEqual([]);
    expect(reduceKey(r, key("backspace"))).toEqual([]);
  });

  test("cut text cannot host a comment or a span", () => {
    const cut = state({ cursorAnnotatable: false });
    expect(reduceKey(cut, key("c"))).toEqual([{ t: "status", msg: "text is cut - restore it first" }]);
    expect(reduceKey(cut, key("s"))).toEqual([{ t: "status", msg: "text is cut - restore it first" }]);
    expect(reduceKey(cut, key("v"))).toEqual([]);
  });

  test("annotation navigation without annotations reports, delete without focus is silent", () => {
    const none = state({ annotationCount: 0, hasFocusedAnnotation: false });
    expect(reduceKey(none, key("n"))).toEqual([{ t: "status", msg: "no annotations" }]);
    expect(reduceKey(none, key("p"))).toEqual([{ t: "status", msg: "no annotations" }]);
    expect(reduceKey(none, key("backspace"))).toEqual([]);
  });

  test("without a selected card x cuts the block and e opens the editor", () => {
    const unfocused = state({ hasFocusedAnnotation: false });
    expect(reduceKey(unfocused, key("x"))).toEqual([{ t: "cut" }]);
    expect(reduceKey(unfocused, key("e"))).toEqual([{ t: "edit" }]);
  });
});

describe("span mode", () => {
  const s = state({ spanMode: true });
  const table: [string, Intent[]][] = [
    ["l", [{ t: "spanKey", name: "l" }]],
    ["h", [{ t: "spanKey", name: "h" }]],
    ["w", [{ t: "spanKey", name: "w" }]],
    ["b", [{ t: "spanKey", name: "b" }]],
    ["$", [{ t: "spanKey", name: "$" }]],
    ["0", [{ t: "spanKey", name: "0" }]],
    ["c", [{ t: "openCompose", kind: "comment", from: "span" }]],
    ["s", [{ t: "openCompose", kind: "suggestion", from: "span" }]],
    ["escape", [{ t: "closeOverlay" }]],
    ["q", [{ t: "exit" }]],
    ["j", []],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(s, key(name))).toEqual(expected);
    });
  }
});

describe("diff mode", () => {
  const s = state({ view: "diff" });
  const table: [string, Intent[]][] = [
    ["j", [{ t: "move", to: "down" }]],
    ["k", [{ t: "move", to: "up" }]],
    ["g", [{ t: "move", to: "top" }]],
    ["c", [{ t: "openCompose", kind: "comment", from: "cursor" }]],
    ["n", [{ t: "nextAnn" }]],
    ["p", [{ t: "prevAnn" }]],
    ["backspace", [{ t: "removeAnnotation" }]],
    ["return", [{ t: "openSubmit" }]],
    ["v", [{ t: "status", msg: "plan-only verb - diff review uses c on a line" }]],
    ["x", [{ t: "status", msg: "plan-only verb - diff review uses c on a line" }]],
    ["e", [{ t: "status", msg: "plan-only verb - diff review uses c on a line" }]],
    ["s", [{ t: "status", msg: "plan-only verb - diff review uses c on a line" }]],
    ["q", [{ t: "exit" }]],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(s, key(name))).toEqual(expected);
    });
  }

  test("comment guards: resolved first, then non-code rows", () => {
    expect(reduceKey(state({ view: "diff", resolved: true }), key("c"))).toEqual([
      { t: "status", msg: "review submitted - read-only" },
    ]);
    expect(reduceKey(state({ view: "diff", cursorAnnotatable: false }), key("c"))).toEqual([
      { t: "status", msg: "move to a code line to comment" },
    ]);
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
      const s = state({ view, readOnly: true });
      for (const name of ["c", "s", "x", "e", "backspace", "return", "enter"]) {
        expect(reduceKey(s, key(name))).toEqual([{ t: "status", msg: "observer - read-only" }]);
      }
    }
  });

  test("navigation and annotation focus still work for observers", () => {
    const s = state({ readOnly: true });
    expect(reduceKey(s, key("j"))).toEqual([{ t: "move", to: "down" }]);
    expect(reduceKey(s, key("n"))).toEqual([{ t: "nextAnn" }]);
    expect(reduceKey(s, key("q"))).toEqual([{ t: "exit" }]);
  });

  test("span-mode c/s are gated by key name even under a rebound keymap", () => {
    const rebound = { ...DEFAULT_KEYS, comment: ["m"], suggest: ["t"] };
    const s = state({ spanMode: true, readOnly: true, keys: rebound });
    expect(reduceKey(s, key("c"))).toEqual([{ t: "status", msg: "observer - read-only" }]);
    expect(reduceKey(s, key("s"))).toEqual([{ t: "status", msg: "observer - read-only" }]);
  });
});
