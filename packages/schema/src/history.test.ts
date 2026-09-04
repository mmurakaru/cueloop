import { describe, expect, test } from "bun:test";
import {
  appendEntry,
  createBranch,
  derivePath,
  followBranch,
  forkHistory,
  historyFromLinear,
  HistoryError,
  labelTip,
  MAIN_BRANCH,
  navigateTo,
  pathOf,
  recaptureMainHead,
  removalEntries,
  switchBranch,
  tipOf,
  validateHistory,
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
    expect(derived.annotationIds).toEqual(["a2"]);
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
    expect(derived.annotationIds).toEqual([]);
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

describe("validateHistory and cycles", () => {
  test("a healthy tree validates; each broken invariant names itself", () => {
    // Arrange
    const healthy = root();
    const entry = healthy.entries[0]!;

    // Assert
    expect(validateHistory(healthy)).toBeNull();
    expect(validateHistory({ ...healthy, entries: [entry, { ...entry }] })).toMatch(
      /duplicate entry id/,
    );
    expect(validateHistory({ ...healthy, entries: [{ ...entry, parentId: "ghost" }] })).toMatch(
      /missing parent/,
    );
    expect(validateHistory({ ...healthy, tips: {} })).toMatch(/no "main" branch/);
    expect(validateHistory({ ...healthy, tips: { main: "ghost" } })).toMatch(/missing entry/);
    expect(validateHistory({ ...healthy, branch: "ramble" })).toMatch(/has no tip/);
    expect(
      validateHistory({
        ...healthy,
        entries: [{ id: "c", parentId: null, type: "comment", annotationId: "a", createdAt: AT }],
        tips: { main: "c" },
      }),
    ).toMatch(/no revision/);
  });

  test("a parent cycle is refused instead of walked forever", () => {
    // Arrange: two entries that point at each other, off the main path
    const healthy = root();
    const loopA = {
      id: "la",
      parentId: "lb",
      type: "comment",
      annotationId: "x",
      createdAt: AT,
    } as const;
    const loopB = {
      id: "lb",
      parentId: "la",
      type: "comment",
      annotationId: "y",
      createdAt: AT,
    } as const;
    const cyclic = { ...healthy, entries: [...healthy.entries, loopA, loopB] };

    // Assert
    expect(validateHistory(cyclic)).toMatch(/own ancestor/);
    expect(() => pathOf(cyclic, "la")).toThrow(HistoryError);
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
    expect(derivePath(fork).annotationIds).toEqual(["a1"]);
    // the label sat on the dropped verdict entry, so it does not travel
    expect(fork.labels).toEqual({});
    expect(history.labels[approvedTip]).toBe("approved v1");
  });

  test("entries after a dropped one are chained to the kept entry before it", () => {
    // Arrange: rev1, verdict, rev2 by the agent, a reviewer edit, a comment on top
    let history = root();

    history = appendEntry(history, { type: "verdict", verdict: VERDICT, createdAt: AT }).history;
    history = appendEntry(history, {
      type: "revision",
      by: "agent",
      content: "Plan v2",
      createdAt: AT,
    }).history;
    history = appendEntry(history, {
      type: "revision",
      by: "reviewer",
      content: "Plan v2 edited",
      createdAt: AT,
    }).history;
    history = appendEntry(history, { type: "comment", annotationId: "a1", createdAt: AT }).history;

    // Act
    const fork = forkHistory(history);

    // Assert: a valid one-branch tree with the agent's head and the comment, edits reset
    expect(validateHistory(fork)).toBeNull();
    expect(fork.entries.map((entry) => entry.type)).toEqual(["revision", "revision", "comment"]);
    expect(derivePath(fork).head.content).toBe("Plan v2");
    expect(derivePath(fork).annotationIds).toEqual(["a1"]);
  });
});

describe("recaptureMainHead", () => {
  test("replaces the agent's current revision on main in place, wherever the reviewer is", () => {
    // Arrange: main at rev1, a reviewer edit on a branch
    let history = createBranch(root(), "alt");

    history = appendEntry(history, {
      type: "revision",
      by: "reviewer",
      content: "Plan v1 edited",
      createdAt: AT,
    }).history;

    // Act
    const recaptured = recaptureMainHead(history, "Plan v1 recaptured");

    // Assert: same entry count, main's head text moved, the branch keeps its edit
    expect(recaptured.entries).toHaveLength(history.entries.length);
    expect(derivePath(recaptured, tipOf(recaptured, MAIN_BRANCH)).head.content).toBe(
      "Plan v1 recaptured",
    );
    expect(derivePath(recaptured).head.content).toBe("Plan v1 edited");
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
    expect(derived.annotationIds).toEqual(["early", "late"]);
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

describe("followBranch", () => {
  test("carries one branch's path and its labels, dropping other branches", () => {
    // Arrange: main has rev1 -> a1 (labelled); a branch off a1 adds a comment
    let history = historyFromLinear({
      id: "ses_1",
      revisions: [{ revision: 1, content: "v1", submittedAt: AT }],
      annotations: [],
      verdict: null,
      createdAt: AT,
    });

    history = appendEntry(history, { type: "comment", annotationId: "a1", createdAt: AT }).history;
    history = labelTip(history, "checkpoint");
    const labelled = tipOf(history);

    history = createBranch(history, "alt");
    history = appendEntry(history, { type: "comment", annotationId: "b1", createdAt: AT }).history;

    // Act: a share following main sees only main's path
    const followed = followBranch(history, MAIN_BRANCH);

    // Assert
    expect(followed.branch).toBe(MAIN_BRANCH);
    expect(followed.tips).toEqual({ [MAIN_BRANCH]: labelled });
    expect(followed.entries.map((entry) => entry.type)).toEqual(["revision", "comment"]);
    expect(followed.labels).toEqual({ [labelled]: "checkpoint" });
    expect(validateHistory(followed)).toBeNull();
  });
});

describe("removalEntries", () => {
  test("returns the comment-removed entries in order, and nothing else", () => {
    // Arrange
    let history = historyFromLinear({
      id: "ses_1",
      revisions: [{ revision: 1, content: "v1", submittedAt: AT }],
      annotations: [],
      verdict: null,
      createdAt: AT,
    });

    history = appendEntry(history, { type: "comment", annotationId: "a1", createdAt: AT }).history;
    history = appendEntry(history, { type: "comment", annotationId: "a2", createdAt: AT }).history;
    history = appendEntry(history, {
      type: "comment-removed",
      annotationId: "a1",
      createdAt: AT,
    }).history;

    // Act
    const removals = removalEntries(history);

    // Assert
    expect(removals.map((entry) => entry.annotationId)).toEqual(["a1"]);
    expect(removals.every((entry) => entry.type === "comment-removed")).toBe(true);
  });
});
