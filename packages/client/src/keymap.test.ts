/** The keyboard grammar as data: every mode x key maps to a known intent list, gated once by the read-only rule. */

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

function key(
  name: string,
  shift = false,
  meta = false,
): { name: string; shift: boolean; meta: boolean } {
  return { name, shift, meta };
}

describe("compose overlay", () => {
  // Arrange
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
  // Arrange
  const keyState = state({ overlay: "submit" });
  const table: [string, Intent[]][] = [
    ["escape", [{ type: "closeOverlay" }]],
    ["return", [{ type: "submitVerdict" }]],
    ["enter", [{ type: "submitVerdict" }]],
    ["left", [{ type: "cycleVerdict", direction: -1 }]],
    ["right", [{ type: "cycleVerdict", direction: 1 }]],
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
  // Arrange
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
  // Arrange
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
    // Arrange
    const empty = state({ view: "inbox", hasInboxItems: false });

    // Assert
    for (const name of ["j", "k", "down", "up", "return", "enter"]) {
      expect(reduceKey(empty, key(name))).toEqual([]);
    }
    expect(reduceKey(empty, key("q"))).toEqual([{ type: "exit" }]);
  });
});

describe("collaborator (share) capabilities", () => {
  test("can annotate: comment opens the composer", () => {
    // Arrange
    const collab = state({ canEditPlan: false, canSubmitVerdict: false });

    // Act / Assert
    expect(reduceKey(collab, key("c"), "comment")).toEqual([
      { type: "openCompose", kind: "comment", from: "cursor" },
    ]);
  });

  test("can edit their own card: edit with a focused annotation rewrites it", () => {
    // Arrange
    const collab = state({ canEditPlan: false, hasFocusedAnnotation: true });

    // Act / Assert
    expect(reduceKey(collab, key("e"), "edit")).toEqual([{ type: "editCard" }]);
  });

  test("cannot edit the plan: cut/edit with no card is silent (no nag, no button)", () => {
    // Arrange
    const collab = state({ canEditPlan: false, hasFocusedAnnotation: false });

    // Act / Assert
    expect(reduceKey(collab, key("e"), "edit")).toEqual([]);
    expect(reduceKey(collab, key("c"), "cut")).toEqual([]);
  });

  test("cannot submit a verdict: there is no agent on a share", () => {
    // Arrange
    const collab = state({ canSubmitVerdict: false });

    // Act / Assert
    expect(reduceKey(collab, key("x"), "submit")).toEqual([
      { type: "status", message: "shared view - your notes save as you go; q to leave" },
    ]);
  });

  test("cannot re-share: only the owner shares", () => {
    // Arrange
    const collab = state({ canShare: false });

    // Act / Assert
    expect(reduceKey(collab, key("S", true), "share")).toEqual([
      { type: "status", message: "only the plan owner can share" },
    ]);
  });
});

describe("share", () => {
  test("the owner's share key publishes", () => {
    // Act / Assert
    expect(reduceKey(state(), key("S", true), "share")).toEqual([{ type: "share" }]);
  });

  test("an observer cannot share", () => {
    // Act / Assert
    expect(reduceKey(state({ readOnly: true }), key("S", true), "share")).toEqual([
      { type: "status", message: "observer - read-only" },
    ]);
  });
});

describe("plan normal mode", () => {
  // Arrange
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
    // Arrange
    const resolvedState = state({ resolved: true });

    // Assert
    for (const name of ["c", "s", "x", "e"]) {
      expect(reduceKey(resolvedState, key(name))).toEqual([
        { type: "status", message: "review submitted - read-only" },
      ]);
    }
    expect(reduceKey(resolvedState, key("return"))).toEqual([]);
    expect(reduceKey(resolvedState, key("backspace"))).toEqual([]);
  });

  test("u restores a rail removal (a cut block); a share viewer's is silent", () => {
    // Assert - the undo intent leaves the target to the dispatcher
    expect(reduceKey(state(), key("u"))).toEqual([{ type: "restoreCuration" }]);
    expect(reduceKey(state({ resolved: true }), key("u"))).toEqual([
      { type: "status", message: "review submitted - read-only" },
    ]);
    expect(reduceKey(state({ canEditPlan: false }), key("u"))).toEqual([]);
    expect(reduceKey(state({ readOnly: true }), key("u"))).toEqual([
      { type: "status", message: "observer - read-only" },
    ]);
  });

  test("cut text cannot host a comment or a span", () => {
    // Arrange
    const cut = state({ cursorAnnotatable: false });

    // Assert
    expect(reduceKey(cut, key("c"))).toEqual([
      { type: "status", message: "text is cut - restore it first" },
    ]);
    expect(reduceKey(cut, key("s"))).toEqual([
      { type: "status", message: "text is cut - restore it first" },
    ]);
    expect(reduceKey(cut, key("v"))).toEqual([]);
  });

  test("annotation navigation without annotations reports, delete without focus is silent", () => {
    // Arrange
    const none = state({ annotationCount: 0, hasFocusedAnnotation: false });

    // Assert
    expect(reduceKey(none, key("n"))).toEqual([{ type: "status", message: "no annotations" }]);
    expect(reduceKey(none, key("p"))).toEqual([{ type: "status", message: "no annotations" }]);
    expect(reduceKey(none, key("backspace"))).toEqual([]);
  });

  test("without a selected card x cuts the block and e opens the editor", () => {
    // Arrange
    const unfocused = state({ hasFocusedAnnotation: false });

    // Assert
    expect(reduceKey(unfocused, key("x"))).toEqual([{ type: "cut" }]);
    expect(reduceKey(unfocused, key("e"))).toEqual([{ type: "edit" }]);
  });
});

describe("span mode", () => {
  // Arrange
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
  // Arrange
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
    ["x", [{ type: "rejectChange" }]],
    ["e", [{ type: "status", message: "plan-only verb - diff review uses c on a line" }]],
    ["s", [{ type: "status", message: "plan-only verb - diff review uses c on a line" }]],
    ["q", [{ type: "exit" }]],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(keyState, key(name))).toEqual(expected);
    });
  }

  test("shift+x rejects the whole hunk under the cursor", () => {
    // Assert
    expect(reduceKey(keyState, key("x", true))).toEqual([{ type: "rejectHunk" }]);
  });

  test("curation is owner-only and locked once resolved", () => {
    // Assert - a resolved diff answers before curating
    expect(reduceKey(state({ view: "diff", resolved: true }), key("x"))).toEqual([
      { type: "status", message: "review submitted - read-only" },
    ]);
    // a collaborator (canEditPlan false) cannot curate hunks
    expect(reduceKey(state({ view: "diff", canEditPlan: false }), key("x"))).toEqual([
      { type: "status", message: "only the diff owner can curate hunks" },
    ]);
    // an observer's mutating attempt is stopped by the read-only gate
    expect(reduceKey(state({ view: "diff", readOnly: true }), key("x"))).toEqual([
      { type: "status", message: "observer - read-only" },
    ]);
  });

  test("u restores a curated-out item, owner-only and locked once resolved", () => {
    // Assert - the undo intent leaves the target to the dispatcher
    expect(reduceKey(keyState, key("u"))).toEqual([{ type: "restoreCuration" }]);
    expect(reduceKey(state({ view: "diff", resolved: true }), key("u"))).toEqual([
      { type: "status", message: "review submitted - read-only" },
    ]);
    expect(reduceKey(state({ view: "diff", canEditPlan: false }), key("u"))).toEqual([
      { type: "status", message: "only the diff owner can curate hunks" },
    ]);
    expect(reduceKey(state({ view: "diff", readOnly: true }), key("u"))).toEqual([
      { type: "status", message: "observer - read-only" },
    ]);
  });

  test("comment guards: resolved first, then non-code rows", () => {
    // Assert
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
    // Assert
    expect(reduceKey(state({ view: "diff" }), key("w"))).toEqual([{ type: "walkStart" }]);
    expect(reduceKey(state({ view: "diff", resolved: true }), key("w"))).toEqual([
      { type: "status", message: "review submitted - read-only" },
    ]);
    expect(reduceKey(state({ view: "diff", readOnly: true }), key("w"))).toEqual([
      { type: "status", message: "observer - read-only" },
    ]);
    expect(reduceKey(state(), key("w"))).toEqual([
      { type: "status", message: "the guided walk is a diff-review mode" },
    ]);
  });

  // Arrange
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
    // Arrange
    const atEnd = state({ view: "diff", overlay: "walk", walkAtEnd: true });

    // Assert
    expect(reduceKey(atEnd, key("return"))).toEqual([
      { type: "walkLeave" },
      { type: "openSubmit" },
    ]);
    expect(reduceKey(atEnd, key("enter"))).toEqual([{ type: "walkLeave" }, { type: "openSubmit" }]);
  });
});

describe("review panel controls", () => {
  const table: [string, Intent[]][] = [
    ["b", [{ type: "cycleReviewPanel" }]],
    ["]", [{ type: "resizeReviewPanel", direction: 1 }]],
    ["[", [{ type: "resizeReviewPanel", direction: -1 }]],
  ];
  for (const view of ["plan", "diff"] as const) {
    for (const [name, expected] of table) {
      test(`${view} ${name} -> ${JSON.stringify(expected)}`, () => {
        expect(reduceKey(state({ view }), key(name))).toEqual(expected);
      });
    }
  }

  test("observers may still collapse and resize the panel (it is view state, not a mutation)", () => {
    // Arrange
    const observer = state({ readOnly: true });

    // Assert
    expect(reduceKey(observer, key("b"))).toEqual([{ type: "cycleReviewPanel" }]);
    expect(reduceKey(observer, key("]"))).toEqual([{ type: "resizeReviewPanel", direction: 1 }]);
  });

  test("span mode still owns b as a span verb, not a panel cycle", () => {
    // Assert
    expect(reduceKey(state({ spanMode: true }), key("b"))).toEqual([
      { type: "spanKey", name: "b" },
    ]);
  });

  test("the walk overlay keeps the brackets for stepping", () => {
    // Arrange
    const walking = state({ view: "diff", overlay: "walk" });

    // Assert
    expect(reduceKey(walking, key("]"))).toEqual([{ type: "walkForward" }]);
    expect(reduceKey(walking, key("["))).toEqual([{ type: "walkBack" }]);
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
        expect(reduceKey(keyState, key(name))).toEqual([
          { type: "status", message: "observer - read-only" },
        ]);
      }
    }
  });

  test("navigation and annotation focus still work for observers", () => {
    // Arrange
    const keyState = state({ readOnly: true });

    // Assert
    expect(reduceKey(keyState, key("j"))).toEqual([{ type: "move", to: "down" }]);
    expect(reduceKey(keyState, key("n"))).toEqual([{ type: "nextAnnotation" }]);
    expect(reduceKey(keyState, key("q"))).toEqual([{ type: "exit" }]);
  });

  test("span-mode c/s are gated by key name even under a rebound keymap", () => {
    // Arrange
    const rebound = { ...DEFAULT_KEYS, comment: ["m"], suggest: ["t"] };
    const keyState = state({ spanMode: true, readOnly: true, keys: rebound });

    // Assert
    expect(reduceKey(keyState, key("c"))).toEqual([
      { type: "status", message: "observer - read-only" },
    ]);
    expect(reduceKey(keyState, key("s"))).toEqual([
      { type: "status", message: "observer - read-only" },
    ]);
  });
});

describe("inbox delete", () => {
  test("d on a session requests delete", () => {
    // Arrange / Act / Assert
    expect(reduceKey(state({ view: "inbox" }), key("d"))).toEqual([
      { type: "requestDeleteSession" },
    ]);
  });
});

describe("confirm overlay", () => {
  // Arrange
  const keyState = state({ overlay: "confirm" });
  const table: [string, Intent[]][] = [
    ["return", [{ type: "confirmDialog" }]],
    ["enter", [{ type: "confirmDialog" }]],
    ["escape", [{ type: "closeOverlay" }]],
    ["j", []],
    ["d", []],
  ];
  for (const [name, expected] of table) {
    test(`${name} -> ${JSON.stringify(expected)}`, () => {
      expect(reduceKey(keyState, key(name))).toEqual(expected);
    });
  }
});

describe("rename grammar", () => {
  test("r on a focused note opens rename", () => {
    // Arrange / Act / Assert
    expect(reduceKey(state({ hasFocusedAnnotation: true }), key("r"))).toEqual([
      { type: "openRename" },
    ]);
  });

  test("prompt overlay routes ⏎ to confirm and esc to cancel", () => {
    // Arrange / Act / Assert
    expect(reduceKey(state({ overlay: "prompt" }), key("return"))).toEqual([
      { type: "confirmDialog" },
    ]);
    expect(reduceKey(state({ overlay: "prompt" }), key("escape"))).toEqual([
      { type: "closeOverlay" },
    ]);
    expect(reduceKey(state({ overlay: "prompt" }), key("a"))).toEqual([]);
  });
});
