import { describe, expect, test } from "bun:test";
import {
  appendEntry,
  createBranch,
  historyFromLinear,
  labelTip,
  navigateTo,
  switchBranch,
  tipOf,
  type SessionHistory,
} from "@cueloop/schema";
import { entryTarget, treeRows } from "./tree-view";

const AT = "2026-09-01T10:00:00.000Z";
const LATER = "2026-09-01T11:00:00.000Z";

/** rev1 -> comment a1 on main; a branch "alt" off a1 with its own comment; main continues with rev2. */
function forked(): SessionHistory {
  let history = historyFromLinear({
    id: "ses_1",
    revisions: [{ revision: 1, content: "v1", submittedAt: AT }],
    annotations: [],
    verdict: null,
    createdAt: AT,
  });

  history = appendEntry(history, { type: "comment", annotationId: "a1", createdAt: AT }).history;
  history = labelTip(history, "start");
  history = createBranch(history, "alt");
  history = appendEntry(history, { type: "comment", annotationId: "b1", createdAt: AT }).history;
  history = switchBranch(history, "main");
  history = appendEntry(history, {
    type: "revision",
    by: "agent",
    content: "v2",
    createdAt: LATER,
  }).history;

  return history;
}

describe("treeRows", () => {
  test("the current branch is the trunk; other segments indent under the entry they grew from", () => {
    // Act
    const rows = treeRows(forked());

    // Assert: rev1, a1 (labelled, alt hangs off it), the alt comment indented, then rev2 as main's tip
    expect(rows.map((row) => [row.depth, row.text, row.onPath])).toEqual([
      [0, "revision 1", true],
      [0, "comment", true],
      [1, "comment", false],
      [0, "revision 2", true],
    ]);
    expect(rows[1]!.label).toBe("start");
    expect(rows[2]!.tips).toEqual(["alt"]);
    expect(rows[3]!.tips).toEqual(["main"]);
    expect(rows[3]!.isCurrentTip).toBe(true);
  });

  test("on the other branch the trunk follows it and main's continuation indents", () => {
    // Act
    const rows = treeRows(switchBranch(forked(), "alt"));

    // Assert
    expect(rows.map((row) => [row.depth, row.text, row.onPath])).toEqual([
      [0, "revision 1", true],
      [0, "comment", true],
      [1, "revision 2", false],
      [0, "comment", true],
    ]);
    expect(rows[3]!.isCurrentTip).toBe(true);
  });

  test("a branch summary reads as a return with its text", () => {
    // Arrange
    const history = navigateTo(forked(), forked().entries[0]!.id, { summary: "too early" });

    // Act
    const rows = treeRows(history);

    // Assert: the summary hangs under rev1 as the trunk, the abandoned segment indents
    expect(rows.find((row) => row.glyph === "↩")?.text).toBe('"too early"');
    expect(rows.find((row) => row.glyph === "↩")?.isCurrentTip).toBe(true);
  });
});

describe("entryTarget", () => {
  test("the tip is here, another tip is a switch, an ancestor is a navigate on its branch", () => {
    // Arrange
    const history = forked();
    const [rev1, a1, altComment, rev2] = history.entries;

    // Assert
    expect(entryTarget(history, rev2!.id)).toEqual({ kind: "here" });
    expect(entryTarget(history, altComment!.id)).toEqual({ kind: "switch", branch: "alt" });
    expect(entryTarget(history, a1!.id)).toEqual({
      kind: "navigate",
      entryId: a1!.id,
      branch: "main",
    });
    expect(entryTarget(history, rev1!.id)?.kind).toBe("navigate");
    expect(tipOf(history)).toBe(rev2!.id);
  });

  test("an entry only another branch reaches is a navigate on that branch", () => {
    // Arrange: alt gets a second comment so its first is no longer a tip
    let history = switchBranch(forked(), "alt");

    history = appendEntry(history, {
      type: "comment",
      annotationId: "b2",
      createdAt: LATER,
    }).history;
    const altFirst = history.entries.find(
      (entry) => entry.type === "comment" && entry.annotationId === "b1",
    )!;

    history = switchBranch(history, "main");

    // Assert
    expect(entryTarget(history, altFirst.id)).toEqual({
      kind: "navigate",
      entryId: altFirst.id,
      branch: "alt",
    });
    expect(entryTarget(history, "e_nope")).toBeNull();
  });
});
