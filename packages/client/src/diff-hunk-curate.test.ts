import { describe, expect, test } from "bun:test";
import { unifiedDiffText, type DiffFileContents } from "@cueloop/schema";
import {
  changeRejectionForRow,
  curateDiff,
  hunkRejectionForRow,
  isRowRejected,
  locateLine,
  parseFileDiff,
  type HunkRejection,
} from "./diff-hunk-curate";
import type { DiffRow } from "./view-diff";

const OLD = "line1\nline2\nline3\nline4\nline5\n";
// Two changes in one hunk: line2 modified, then a pure addition after line4.
const NEW = "line1\nCHANGED2\nline3\nline4\nADDED\nline5\n";
const FILE: DiffFileContents = { path: "src/a.ts", oldContents: OLD, newContents: NEW };

// Two changes far apart, so the model splits into two hunks.
const MULTI_OLD = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n";
const MULTI_NEW = "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\nl\n";
const MULTI: DiffFileContents = {
  path: "src/b.ts",
  oldContents: MULTI_OLD,
  newContents: MULTI_NEW,
};

describe("curateDiff", () => {
  test("no rejections reproduces the full per-file diff", () => {
    // Arrange
    const rejections: HunkRejection[] = [];

    // Act
    const patch = curateDiff([FILE], rejections);

    // Assert
    expect(patch).toBe(unifiedDiffText(OLD, NEW, FILE.path)!);
    expect(patch).toContain("+CHANGED2");
    expect(patch).toContain("+ADDED");
  });

  test("whole-hunk reject drops every change in that hunk", () => {
    // Arrange
    const rejections: HunkRejection[] = [{ path: FILE.path, hunkIndex: 0 }];

    // Act
    const patch = curateDiff([FILE], rejections);

    // Assert - the only hunk was reverted, so nothing is left to apply
    expect(patch).toBe("");
  });

  test("change-level reject keeps the other accepted change exactly", () => {
    // Arrange - reject the line2 modification (hunkContent index 1), keep ADDED
    const rejections: HunkRejection[] = [{ path: FILE.path, hunkIndex: 0, changeIndex: 1 }];
    const expectedNew = "line1\nline2\nline3\nline4\nADDED\nline5\n";

    // Act
    const patch = curateDiff([FILE], rejections);

    // Assert
    expect(patch).toBe(unifiedDiffText(OLD, expectedNew, FILE.path)!);
    expect(patch).not.toContain("CHANGED2");
    expect(patch).toContain("+ADDED");
  });

  test("change-level reject of the addition keeps the modification", () => {
    // Arrange - reject the pure addition (hunkContent index 3), keep CHANGED2
    const rejections: HunkRejection[] = [{ path: FILE.path, hunkIndex: 0, changeIndex: 3 }];
    const expectedNew = "line1\nCHANGED2\nline3\nline4\nline5\n";

    // Act
    const patch = curateDiff([FILE], rejections);

    // Assert
    expect(patch).toBe(unifiedDiffText(OLD, expectedNew, FILE.path)!);
    expect(patch).toContain("+CHANGED2");
    expect(patch).not.toContain("ADDED");
  });

  test("rejecting every change in a file yields an empty patch", () => {
    // Arrange
    const rejections: HunkRejection[] = [
      { path: FILE.path, hunkIndex: 0, changeIndex: 1 },
      { path: FILE.path, hunkIndex: 0, changeIndex: 3 },
    ];

    // Act
    const patch = curateDiff([FILE], rejections);

    // Assert
    expect(patch).toBe("");
  });

  test("whole-hunk reject supersedes a change reject for the same hunk", () => {
    // Arrange - a redundant change reject alongside the whole-hunk reject
    const rejections: HunkRejection[] = [
      { path: FILE.path, hunkIndex: 0 },
      { path: FILE.path, hunkIndex: 0, changeIndex: 1 },
    ];

    // Act
    const patch = curateDiff([FILE], rejections);

    // Assert
    expect(patch).toBe("");
  });

  test("multi-file curation keeps each file's accepted changes independent", () => {
    // Arrange - reject file A's addition; leave file B whole
    const rejections: HunkRejection[] = [{ path: FILE.path, hunkIndex: 0, changeIndex: 3 }];

    // Act
    const patch = curateDiff([FILE, MULTI], rejections);

    // Assert
    expect(patch).toContain("src/a.ts");
    expect(patch).toContain("src/b.ts");
    expect(patch).toContain("+CHANGED2");
    expect(patch).not.toContain("+ADDED");
    expect(patch).toContain("+B");
    expect(patch).toContain("+K");
  });

  test("rejecting one of two hunks reverts only that hunk", () => {
    // Arrange - reject the first hunk (B), keep the second (K)
    const rejections: HunkRejection[] = [{ path: MULTI.path, hunkIndex: 0 }];
    const expectedNew = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nK\nl\n";

    // Act
    const patch = curateDiff([MULTI], rejections);

    // Assert
    expect(patch).toBe(unifiedDiffText(MULTI_OLD, expectedNew, MULTI.path)!);
  });
});

describe("locateLine and row mapping", () => {
  test("locateLine resolves a modified new line to its change block", () => {
    // Arrange
    const model = parseFileDiff(FILE);

    // Act - CHANGED2 is new line 2
    const located = locateLine(model, "addition", 2);

    // Assert
    expect(located).toEqual({ hunkIndex: 0, changeIndex: 1 });
  });

  test("locateLine resolves the pure addition to its change block", () => {
    // Arrange
    const model = parseFileDiff(FILE);

    // Act - ADDED is new line 5
    const located = locateLine(model, "addition", 5);

    // Assert
    expect(located).toEqual({ hunkIndex: 0, changeIndex: 3 });
  });

  test("locateLine resolves a context line to a hunk with no change index", () => {
    // Arrange
    const model = parseFileDiff(FILE);

    // Act - line1 is unchanged context
    const located = locateLine(model, "addition", 1);

    // Assert
    expect(located).toEqual({ hunkIndex: 0, changeIndex: undefined });
  });

  test("changeRejectionForRow targets the change under an addition row", () => {
    // Arrange
    const model = parseFileDiff(FILE);
    const row: DiffRow = { kind: "add", text: "CHANGED2\n", file: FILE.path, newLine: 2 };

    // Act
    const rejection = changeRejectionForRow(FILE.path, model, row);

    // Assert
    expect(rejection).toEqual({ path: FILE.path, hunkIndex: 0, changeIndex: 1 });
  });

  test("changeRejectionForRow targets the change under a deletion row", () => {
    // Arrange
    const model = parseFileDiff(FILE);
    const row: DiffRow = { kind: "del", text: "line2\n", file: FILE.path, oldLine: 2 };

    // Act
    const rejection = changeRejectionForRow(FILE.path, model, row);

    // Assert
    expect(rejection).toEqual({ path: FILE.path, hunkIndex: 0, changeIndex: 1 });
  });

  test("changeRejectionForRow returns null on a context row", () => {
    // Arrange
    const model = parseFileDiff(FILE);
    const row: DiffRow = { kind: "ctx", text: "line1\n", file: FILE.path, oldLine: 1, newLine: 1 };

    // Act
    const rejection = changeRejectionForRow(FILE.path, model, row);

    // Assert
    expect(rejection).toBeNull();
  });

  test("hunkRejectionForRow targets the enclosing hunk of a context row", () => {
    // Arrange
    const model = parseFileDiff(FILE);
    const row: DiffRow = { kind: "ctx", text: "line1\n", file: FILE.path, oldLine: 1, newLine: 1 };

    // Act
    const rejection = hunkRejectionForRow(FILE.path, model, row);

    // Assert
    expect(rejection).toEqual({ path: FILE.path, hunkIndex: 0 });
  });

  test("hunkRejectionForRow resolves the second hunk in a multi-hunk file", () => {
    // Arrange
    const model = parseFileDiff(MULTI);
    const row: DiffRow = { kind: "add", text: "K\n", file: MULTI.path, newLine: 11 };

    // Act
    const rejection = hunkRejectionForRow(MULTI.path, model, row);

    // Assert
    expect(rejection).toEqual({ path: MULTI.path, hunkIndex: 1 });
  });
});

describe("isRowRejected", () => {
  test("a change row is rejected when its whole hunk is rejected", () => {
    // Arrange
    const model = parseFileDiff(FILE);
    const row: DiffRow = { kind: "add", text: "ADDED\n", file: FILE.path, newLine: 5 };
    const rejections: HunkRejection[] = [{ path: FILE.path, hunkIndex: 0 }];

    // Act
    const rejected = isRowRejected(FILE.path, model, row, rejections);

    // Assert
    expect(rejected).toBe(true);
  });

  test("a change row is rejected only by its own change-level decision", () => {
    // Arrange
    const model = parseFileDiff(FILE);
    const addedRow: DiffRow = { kind: "add", text: "ADDED\n", file: FILE.path, newLine: 5 };
    const changedRow: DiffRow = { kind: "add", text: "CHANGED2\n", file: FILE.path, newLine: 2 };
    const rejections: HunkRejection[] = [{ path: FILE.path, hunkIndex: 0, changeIndex: 3 }];

    // Act + Assert - only the addition's change is dropped
    expect(isRowRejected(FILE.path, model, addedRow, rejections)).toBe(true);
    expect(isRowRejected(FILE.path, model, changedRow, rejections)).toBe(false);
  });

  test("a context row is never marked rejected", () => {
    // Arrange
    const model = parseFileDiff(FILE);
    const row: DiffRow = { kind: "ctx", text: "line1\n", file: FILE.path, oldLine: 1, newLine: 1 };
    const rejections: HunkRejection[] = [{ path: FILE.path, hunkIndex: 0 }];

    // Act
    const rejected = isRowRejected(FILE.path, model, row, rejections);

    // Assert
    expect(rejected).toBe(false);
  });
});

describe("curateDiff file-state headers", () => {
  test("an accepted created file points its old side at /dev/null", () => {
    // Arrange - a new file has empty old contents
    const created: DiffFileContents = {
      path: "src/new.ts",
      oldContents: "",
      newContents: "one\ntwo\n",
    };

    // Act
    const patch = curateDiff([created], []);

    // Assert
    expect(patch).toContain("--- /dev/null");
    expect(patch).toContain("+++ b/src/new.ts");
    expect(patch).toContain("+one");
  });

  test("an accepted deleted file points its new side at /dev/null", () => {
    // Arrange - a deleted file has empty new contents
    const deleted: DiffFileContents = {
      path: "src/gone.ts",
      oldContents: "one\ntwo\n",
      newContents: "",
    };

    // Act
    const patch = curateDiff([deleted], []);

    // Assert
    expect(patch).toContain("--- a/src/gone.ts");
    expect(patch).toContain("+++ /dev/null");
    expect(patch).toContain("-one");
  });
});
