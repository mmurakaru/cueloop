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
    deleteSession: mock(),
    setSelfName: mock(),
    cut: mock(),
    annotate: mock(),
    updateAnnotation: mock(),
    removeAnnotation: mock(),
    walkStart: mock(),
    walkForward: mock(),
    walkBack: mock(),
    walkLeave: mock(),
    submit: mock(),
    share: mock(),
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
    authorNames: {},
    renameAuthor: mock(),
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
    const advance = (deps.setCursor as ReturnType<typeof mock>).mock.calls[0]![0] as (
      current: number,
    ) => number;
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
    (session.annotations[1] as { resolution?: object }).resolution = {
      revision: 2,
      source: "agent",
    };
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
    expect(deps.setMode).toHaveBeenCalledWith({
      type: "submit",
      verdict: "request_changes",
      summary: "",
    });
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

describe("share", () => {
  test("dispatches to the controller's share", () => {
    // Arrange
    const deps = makeDeps();
    const dispatch = createIntentDispatch(deps);

    // Act
    dispatch({ type: "share" });

    // Assert
    expect(deps.controller.share).toHaveBeenCalled();
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

describe("inbox delete", () => {
  test("requestDeleteSession opens the confirm on the cursor row", () => {
    // Arrange
    const inbox = [{ id: "ses_1", artifact: { meta: { title: "Plan A" } } }] as never;
    const deps = makeDeps({ inbox, inboxCursor: 0 });

    // Act
    createIntentDispatch(deps)({ type: "requestDeleteSession" });

    // Assert
    expect(deps.setMode).toHaveBeenCalledWith({
      type: "confirmDelete",
      sessionId: "ses_1",
      title: "Plan A",
    });
  });

  test("confirmDialog deletes the session and closes", () => {
    // Arrange
    const deps = makeDeps({ mode: { type: "confirmDelete", sessionId: "ses_1", title: "Plan A" } });

    // Act
    createIntentDispatch(deps)({ type: "confirmDialog" });

    // Assert
    expect(deps.controller.deleteSession).toHaveBeenCalledWith("ses_1");
    expect(deps.setMode).toHaveBeenCalledWith({ type: "normal" });
  });
});

describe("rename author", () => {
  test("openRename seeds the prompt with the author's current local name", () => {
    // Arrange
    const session = { annotations: [{ id: "a1", author: "SHA256:x" }] } as never;
    const deps = makeDeps({
      session,
      focusedAnnotationId: "a1",
      authorNames: { "SHA256:x": "Alex" },
    });

    // Act
    createIntentDispatch(deps)({ type: "openRename" });

    // Assert
    expect(deps.setMode).toHaveBeenCalledWith({
      type: "rename",
      authorId: "SHA256:x",
      text: "Alex",
    });
  });

  test("openRename on your own note does nothing but explain", () => {
    // Arrange
    const session = { annotations: [{ id: "a1" }] } as never;
    const deps = makeDeps({ session, focusedAnnotationId: "a1" });

    // Act
    createIntentDispatch(deps)({ type: "openRename" });

    // Assert
    expect(deps.controller.setStatus).toHaveBeenCalled();
    expect(deps.setMode).not.toHaveBeenCalled();
  });

  test("confirmDialog in rename mode persists the trimmed name and closes", () => {
    // Arrange
    const deps = makeDeps({ mode: { type: "rename", authorId: "SHA256:x", text: "  Alex  " } });

    // Act
    createIntentDispatch(deps)({ type: "confirmDialog" });

    // Assert
    expect(deps.renameAuthor).toHaveBeenCalledWith("SHA256:x", "Alex");
    expect(deps.setMode).toHaveBeenCalledWith({ type: "normal" });
  });
});

describe("collaborator self-name", () => {
  test("confirmDialog in nameSelf mode records the trimmed name and closes", () => {
    // Arrange
    const deps = makeDeps({ mode: { type: "nameSelf", text: "  Robin  " } });

    // Act
    createIntentDispatch(deps)({ type: "confirmDialog" });

    // Assert
    expect(deps.controller.setSelfName).toHaveBeenCalledWith("Robin");
    expect(deps.setMode).toHaveBeenCalledWith({ type: "normal" });
  });

  test("an empty name still closes - the collaborator stays anonymous", () => {
    // Arrange
    const deps = makeDeps({ mode: { type: "nameSelf", text: "   " } });

    // Act
    createIntentDispatch(deps)({ type: "confirmDialog" });

    // Assert
    expect(deps.controller.setSelfName).toHaveBeenCalledWith("");
    expect(deps.setMode).toHaveBeenCalledWith({ type: "normal" });
  });
});
