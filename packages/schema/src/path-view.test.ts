import { describe, expect, test } from "bun:test";
import {
  appendEntry,
  createBranch,
  historyFromLinear,
  navigateTo,
  switchBranch,
  type SessionHistory,
} from "./history";
import { applyPathView, viewOfPath } from "./path-view";
import type { Annotation, ReviewSession } from "./types";

const AT = "2026-09-01T10:00:00.000Z";

function annotation(id: string): Annotation {
  return {
    id,
    kind: "comment",
    anchor: { quote: "q", prefix: "", suffix: "" },
    body: id,
    createdAt: AT,
  };
}

/** rev1 (agent) -> comment a1 -> reviewer edit -> comment a2, all on main. */
function threaded(): SessionHistory {
  let history = historyFromLinear({
    id: "ses_1",
    revisions: [{ revision: 1, content: "Plan v1", submittedAt: AT }],
    annotations: [],
    verdict: null,
    createdAt: AT,
  });

  history = appendEntry(history, { type: "comment", annotationId: "a1", createdAt: AT }).history;
  history = appendEntry(history, {
    type: "revision",
    by: "reviewer",
    content: "Plan v1 edited",
    createdAt: AT,
  }).history;
  history = appendEntry(history, { type: "comment", annotationId: "a2", createdAt: AT }).history;

  return history;
}

describe("viewOfPath", () => {
  test("the artifact is the agent's last revision and the reviewer's head is the working copy", () => {
    // Act
    const view = viewOfPath(threaded(), [annotation("a1"), annotation("a2")]);

    // Assert
    expect(view.content).toBe("Plan v1");
    expect(view.workingCopy).toBe("Plan v1 edited");
    expect(view.annotations.map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect(view.shelvedAnnotations).toEqual([]);
  });

  test("navigating back shelves the comments the path no longer reaches, and forward again unshelves them", () => {
    // Arrange: a branch that stays at the full path, main moved back to the first comment
    let history = createBranch(threaded(), "full");
    const known = [annotation("a1"), annotation("a2")];

    history = switchBranch(history, "main");
    history = navigateTo(history, history.entries[1]!.id);

    // Act
    const back = viewOfPath(history, known);
    const forward = viewOfPath(
      switchBranch(history, "full"),
      back.annotations.concat(back.shelvedAnnotations),
    );

    // Assert
    expect(back.workingCopy).toBeUndefined();
    expect(back.annotations.map((entry) => entry.id)).toEqual(["a1"]);
    expect(back.shelvedAnnotations.map((entry) => entry.id)).toEqual(["a2"]);
    expect(forward.annotations.map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect(forward.shelvedAnnotations).toEqual([]);
  });

  test("a removed comment stays shelved, not deleted", () => {
    // Arrange
    let history = threaded();

    history = appendEntry(history, {
      type: "comment-removed",
      annotationId: "a1",
      createdAt: AT,
    }).history;

    // Act
    const view = viewOfPath(history, [annotation("a1"), annotation("a2")]);

    // Assert
    expect(view.annotations.map((entry) => entry.id)).toEqual(["a2"]);
    expect(view.shelvedAnnotations.map((entry) => entry.id)).toEqual(["a1"]);
  });
});

describe("applyPathView", () => {
  test("writes the view into the record and removes the fields the view leaves empty", () => {
    // Arrange
    const session: ReviewSession = {
      schemaVersion: "1",
      id: "ses_1",
      workspace: { repoRoot: "/repo", branch: "main" },
      artifact: { type: "plan", content: "old", meta: {} },
      revisions: [],
      annotations: [annotation("a2")],
      shelvedAnnotations: [annotation("a1")],
      workingCopy: "edited",
      verdict: null,
      status: "pending",
      createdAt: AT,
    };

    // Act
    applyPathView(session, {
      content: "Plan v1",
      workingCopy: undefined,
      annotations: [annotation("a1"), annotation("a2")],
      shelvedAnnotations: [],
    });

    // Assert
    expect(session.artifact.content).toBe("Plan v1");
    expect(session.annotations.map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect("workingCopy" in session).toBe(false);
    expect("shelvedAnnotations" in session).toBe(false);
  });
});
