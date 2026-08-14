/**
 * The intent reducer in isolation: with the App component's dependencies
 * mocked, each Intent maps to exactly the controller call or state update it
 * should - the navigation clamps, the annotation wrap-around, the verdict
 * cycle, and the submit-reveal fix, none of which needed a rendered TUI.
 */

import { describe, expect, mock, test } from "bun:test";
import type { ReviewSession } from "@cueloop/schema";
import { createIntentDispatch, type IntentDispatchDeps } from "./intent-dispatch";
import type { DisplayBlock } from "./view-plan";

function block(text: string): DisplayBlock {
  return { text, kind: "text", work: true } as unknown as DisplayBlock;
}

function sessionWith(annotationIds: string[]): ReviewSession {
  return {
    annotations: annotationIds.map((id) => ({ id })),
    workingCopy: undefined,
  } as unknown as ReviewSession;
}

/** A deps bag where every effect is a mock and every read has a plain default. */
function makeDeps(overrides: Partial<IntentDispatchDeps> = {}): IntentDispatchDeps {
  const controller = {
    setStatus: mock(),
    open: mock(),
    cut: mock(),
    annotate: mock(),
    updateAnnotation: mock(),
    removeAnnotation: mock(),
    walkStart: mock(),
    walkForward: mock(),
    walkBack: mock(),
    walkLeave: mock(),
    submit: mock(),
    finishReview: mock(),
    optInAutoClose: mock(),
    dismissCompletion: mock(),
    saveReviewPanel: mock(),
  };
  return {
    controller: controller as unknown as IntentDispatchDeps["controller"],
    onExit: mock(),
    isDiff: false,
    display: [],
    rows: [],
    cursor: 0,
    inbox: null,
    inboxCursor: 0,
    mode: { type: "normal" },
    session: null,
    reviewMode: "expanded",
    reviewWidth: 34,
    terminalWidth: 120,
    focusedAnnotationId: undefined,
    liveInput: { current: "" },
    reviewWidthRef: { current: 34 },
    planSheetRef: { current: null },
    setCursor: mock(),
    setInboxCursor: mock(),
    setMode: mock(),
    setReviewMode: mock(),
    setReviewWidth: mock(),
    setRailTab: mock(),
    setFocusedAnnotationId: mock(),
    setPulsedAnnotationId: mock(),
    selectCardFromDocument: mock(),
    runEditorHandOff: mock(),
    openCardEdit: mock(),
    ...overrides,
  };
}

describe("move", () => {
  test("down clamps at the last row and up clamps at the first", () => {
    // Arrange
    const deps = makeDeps({ display: [block("a"), block("b"), block("c")] });
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "move", to: "down" });

    // Assert
    const advance = (deps.setCursor as ReturnType<typeof mock>).mock.calls[0]![0] as (current: number) => number;
    expect(advance(2)).toBe(2); // already at the end, stays
    expect(advance(0)).toBe(1);
  });

  test("bottom jumps to the last navigable row", () => {
    // Arrange
    const deps = makeDeps({ display: [block("a"), block("b"), block("c")] });
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "move", to: "bottom" });

    // Assert
    expect(deps.setCursor).toHaveBeenCalledWith(2);
  });
});

describe("annotation navigation", () => {
  test("nextAnnotation wraps from the last annotation back to the first", () => {
    // Arrange
    const deps = makeDeps({ session: sessionWith(["a1", "a2", "a3"]), focusedAnnotationId: "a3" });
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "nextAnnotation" });

    // Assert
    expect(deps.selectCardFromDocument).toHaveBeenCalledWith("a1");
  });

  test("prevAnnotation wraps from the first annotation to the last", () => {
    // Arrange
    const deps = makeDeps({ session: sessionWith(["a1", "a2", "a3"]), focusedAnnotationId: "a1" });
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "prevAnnotation" });

    // Assert
    expect(deps.selectCardFromDocument).toHaveBeenCalledWith("a3");
  });

  test("cycling skips annotations a revision already addressed", () => {
    // Arrange: a2 is addressed, so next from a1 lands on a3
    const session = sessionWith(["a1", "a2", "a3"]);
    (session.annotations[1] as { resolution?: object }).resolution = { revision: 2, source: "agent" };
    const deps = makeDeps({ session, focusedAnnotationId: "a1" });
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "nextAnnotation" });

    // Assert
    expect(deps.selectCardFromDocument).toHaveBeenCalledWith("a3");
  });
});

describe("cycleVerdict", () => {
  test("advances through the verdict list in the submit overlay", () => {
    // Arrange
    const deps = makeDeps({ mode: { type: "submit", verdict: "approve", summary: "" } });
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "cycleVerdict", direction: 1 });

    // Assert
    expect(deps.setMode).toHaveBeenCalledWith({ type: "submit", verdict: "request_changes", summary: "" });
  });
});

describe("openSubmit", () => {
  test("force-opens the review rail so the confirm card can never be hidden", () => {
    // Arrange
    const deps = makeDeps({ session: sessionWith([]), reviewMode: "hidden" });
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "openSubmit" });

    // Assert
    expect(deps.setReviewMode).toHaveBeenCalledWith("expanded");
    expect(deps.setRailTab).toHaveBeenCalledWith("review");
    expect(deps.setMode).toHaveBeenCalledWith({ type: "submit", verdict: "approve", summary: "" });
  });

  test("does nothing without a session", () => {
    // Arrange
    const deps = makeDeps({ session: null });
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "openSubmit" });

    // Assert
    expect(deps.setMode).not.toHaveBeenCalled();
  });
});

describe("exit", () => {
  test("calls the exit hook with 0", () => {
    // Arrange
    const deps = makeDeps();
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "exit" });

    // Assert
    expect(deps.onExit).toHaveBeenCalledWith(0);
  });
});
