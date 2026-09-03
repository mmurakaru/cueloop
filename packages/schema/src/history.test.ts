import { describe, expect, test } from "bun:test";
import {
  appendEntry,
  createBranch,
  derivePath,
  forkHistory,
  historyFromLinear,
  HistoryError,
  labelTip,
  MAIN_BRANCH,
  navigateTo,
  pathOf,
  switchBranch,
  tipOf,
  type SessionHistory,
} from "./history";
import type { Annotation, Verdict } from "./types";

const AT = "2026-09-01T10:00:00.000Z";
const VERDICT: Verdict = { kind: "approve", summary: "", feedback: "", resolvedAt: AT };

function annotation(id: string, createdAt: string): Annotation {
  return {
    id,
    kind: "comment",
    anchor: { quote: "q", prefix: "", suffix: "" },
    body: id,
    createdAt,
  };
}

/** A fresh history: one agent revision on main. */
function root(): SessionHistory {
  return historyFromLinear({
    id: "ses_1",
    revisions: [{ revision: 1, content: "Plan v1", submittedAt: AT }],
    annotations: [],
    verdict: null,
    createdAt: AT,
  });
}

describe("appendEntry and derivePath", () => {
  test("entries chain on the current tip and the path derives the head, comments, and verdicts", () => {
    // Arrange
    let history = root();

    // Act
    history = appendEntry(history, { type: "comment", annotationId: "a1", createdAt: AT }).history;
    history = appendEntry(history, { type: "comment", annotationId: "a2", createdAt: AT }).history;
    history = appendEntry(history, {
      type: "comment-removed",
      annotationId: "a1",
      createdAt: AT,
    }).history;
    history = appendEntry(history, { type: "verdict", verdict: VERDICT, createdAt: AT }).history;
    history = appendEntry(history, {
      type: "revision",
      by: "agent",
      content: "Plan v2",
      createdAt: AT,
    }).history;

    // Assert
    const derived = derivePath(history);

    expect(derived.head.content).toBe("Plan v2");
    expect(derived.openAnnotationIds).toEqual(["a2"]);
    expect(derived.verdicts).toEqual([VERDICT]);
    expect(derived.rounds).toBe(2);
    expect(pathOf(history).map((entry) => entry.type)).toEqual([
      "revision",
      "comment",
      "comment",
      "comment-removed",
      "verdict",
      "revision",
    ]);
  });
});

describe("branches and navigation", () => {
  test("a branch starts at the tip, ramble stays off main, navigating back leaves a summary", () => {
    // Arrange
    let history = labelTip(root(), "before ramble");
    const checkpoint = tipOf(history);

    history = createBranch(history, "ramble");
    history = appendEntry(history, { type: "comment", annotationId: "r1", createdAt: AT }).history;
    history = appendEntry(history, {
      type: "revision",
      by: "reviewer",
      content: "Plan v1 (edited)",
      createdAt: AT,
    }).history;
    expect(derivePath(history).head.content).toBe("Plan v1 (edited)");
    expect(tipOf(history, MAIN_BRANCH)).toBe(checkpoint);

    // Act
    history = navigateTo(history, checkpoint, {
      summary: "explored dropping the daemon",
      createdAt: AT,
    });

    // Assert: the ramble's entries stay, the tip sits on the summary at the checkpoint
    expect(history.entries).toHaveLength(4);
    const derived = derivePath(history);

    expect(derived.head.content).toBe("Plan v1");
    expect(derived.openAnnotationIds).toEqual([]);
    expect(derived.summaries[0]!.abandoned).toHaveLength(2);
    expect(history.labels[checkpoint]).toBe("before ramble");

    // Act
    history = switchBranch(history, MAIN_BRANCH);

    // Assert
    expect(derivePath(history).summaries).toEqual([]);
  });

  test("navigating without a summary just moves the tip", () => {
    // Arrange
    let history = root();
    const checkpoint = tipOf(history);

    history = appendEntry(history, { type: "comment", annotationId: "a1", createdAt: AT }).history;

    // Act
    history = navigateTo(history, checkpoint);

    // Assert
    expect(tipOf(history)).toBe(checkpoint);
    expect(history.entries).toHaveLength(2);
  });

  test("refusals: unknown entry, the current tip, an entry off the branch, a duplicate branch", () => {
    // Arrange
    let history = root();
    const checkpoint = tipOf(history);

    history = createBranch(history, "ramble");
    history = appendEntry(history, { type: "comment", annotationId: "r1", createdAt: AT }).history;
    const rambleTip = tipOf(history);

    history = switchBranch(history, MAIN_BRANCH);

    // Assert
    expect(() => navigateTo(history, "nope")).toThrow(HistoryError);
    expect(() => navigateTo(history, checkpoint)).toThrow(/already/);
    expect(() => navigateTo(history, rambleTip)).toThrow(/not on branch/);
    expect(() => createBranch(history, "ramble")).toThrow(/exists/);
    expect(() => switchBranch(history, "ghost")).toThrow(/no branch/);
  });
});

describe("forkHistory", () => {
  test("copies the path with its comments and labels, drops verdicts, starts at the head", () => {
    // Arrange
    let history = root();

    history = appendEntry(history, { type: "comment", annotationId: "a1", createdAt: AT }).history;
    history = appendEntry(history, { type: "verdict", verdict: VERDICT, createdAt: AT }).history;
    history = labelTip(history, "approved v1");
    const approvedTip = tipOf(history);

    history = createBranch(history, "other");
    history = appendEntry(history, { type: "comment", annotationId: "off", createdAt: AT }).history;
    history = switchBranch(history, MAIN_BRANCH);

    // Act
    const fork = forkHistory(history);

    // Assert
    expect(fork.entries.map((entry) => entry.type)).toEqual(["revision", "comment"]);
    expect(fork.tips).toEqual({ [MAIN_BRANCH]: fork.entries[1]!.id });
    expect(derivePath(fork).openAnnotationIds).toEqual(["a1"]);
    // the label sat on the dropped verdict entry, so it does not travel
    expect(fork.labels).toEqual({});
    expect(history.labels[approvedTip]).toBe("approved v1");
  });
});

describe("historyFromLinear", () => {
  test("chains revisions on main, files comments after the revision they were made on, ends with the verdict", () => {
    // Act
    const history = historyFromLinear({
      id: "ses_9",
      revisions: [
        { revision: 1, content: "v1", submittedAt: "2026-09-01T10:00:00.000Z" },
        { revision: 2, content: "v2", submittedAt: "2026-09-01T12:00:00.000Z" },
      ],
      annotations: [
        annotation("late", "2026-09-01T13:00:00.000Z"),
        annotation("early", "2026-09-01T11:00:00.000Z"),
      ],
      verdict: VERDICT,
      createdAt: "2026-09-01T09:00:00.000Z",
    });

    // Assert
    expect(
      history.entries.map(
        (entry) => `${entry.type}:${"annotationId" in entry ? entry.annotationId : ""}`,
      ),
    ).toEqual(["revision:", "comment:early", "revision:", "comment:late", "verdict:"]);
    expect(history.entries[0]!.id).toBe("ses_9_rev1");
    expect(history.branch).toBe(MAIN_BRANCH);
    const derived = derivePath(history);

    expect(derived.head.content).toBe("v2");
    expect(derived.openAnnotationIds).toEqual(["early", "late"]);
    expect(derived.verdicts).toEqual([VERDICT]);
    expect(derived.rounds).toBe(2);
  });

  test("is deterministic: the same record migrates to the same tree", () => {
    // Arrange
    const record = {
      id: "ses_2",
      revisions: [{ revision: 1, content: "v1", submittedAt: AT }],
      annotations: [annotation("a", AT)],
      verdict: null,
      createdAt: AT,
    };

    // Assert
    expect(historyFromLinear(record)).toEqual(historyFromLinear(record));
  });
});
