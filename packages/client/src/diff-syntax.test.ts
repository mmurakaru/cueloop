import { describe, expect, test } from "bun:test";
import { highlightJobs, spansByLine } from "./diff-syntax";
import type { DiffRow } from "./view-diff";
import type { SimpleHighlight } from "@opentui/core";

function row(kind: DiffRow["kind"], text: string, file = "src/x.ts"): DiffRow {
  return { kind, text, file };
}

describe("spansByLine", () => {
  test("maps absolute offsets to line-relative spans", () => {
    // Arrange
    const source = "const x = 1;\nfoo";
    const highlights: SimpleHighlight[] = [
      [0, 5, "keyword"],
      [6, 7, "variable"],
      [13, 16, "variable"],
    ];

    // Act
    const lineSpans = spansByLine(source, highlights);

    // Assert
    expect(lineSpans[0]).toEqual([
      { start: 0, end: 5, group: "keyword" },
      { start: 6, end: 7, group: "variable" },
    ]);
    expect(lineSpans[1]).toEqual([{ start: 0, end: 3, group: "variable" }]);
  });

  test("spreads a capture that crosses newlines onto every line it covers", () => {
    // Arrange - one capture spanning both lines, as a block comment would
    const source = "aa\nbb";
    const highlights: SimpleHighlight[] = [[0, 5, "comment"]];

    // Act
    const lineSpans = spansByLine(source, highlights);

    // Assert
    expect(lineSpans[0]).toEqual([{ start: 0, end: 2, group: "comment" }]);
    expect(lineSpans[1]).toEqual([{ start: 0, end: 2, group: "comment" }]);
  });

  test("resolves overlapping captures with later winning", () => {
    // Arrange
    const source = "foo";
    const highlights: SimpleHighlight[] = [
      [0, 3, "variable"],
      [0, 3, "type"],
    ];

    // Act
    const lineSpans = spansByLine(source, highlights);

    // Assert
    expect(lineSpans[0]).toEqual([{ start: 0, end: 3, group: "type" }]);
  });
});

describe("highlightJobs", () => {
  test("reconstructs old and new sides of a hunk with row indices", () => {
    // Arrange
    const rows = [
      row("file", "src/x.ts", "src/x.ts"),
      row("hunk", "@@ -1,2 +1,2 @@"),
      row("ctx", "const a = 1;"),
      row("del", "const b = 2;"),
      row("add", "const b = 3;"),
    ];

    // Act
    const jobs = highlightJobs(rows);

    // Assert
    // old side = context + deletion; new side = context + addition
    expect(jobs).toEqual([
      { filetype: "typescript", source: "const a = 1;\nconst b = 2;", rowIndexByLine: [2, 3] },
      { filetype: "typescript", source: "const a = 1;\nconst b = 3;", rowIndexByLine: [2, 4] },
    ]);
  });

  test("skips files with no known filetype", () => {
    // Arrange
    const rows = [
      row("file", "notes/thing.unknownext", "notes/thing.unknownext"),
      row("hunk", "@@"),
      row("add", "whatever"),
    ];

    // Act
    const jobs = highlightJobs(rows);

    // Assert
    expect(jobs).toEqual([]);
  });
});
