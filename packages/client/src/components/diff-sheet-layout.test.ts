import { describe, expect, test } from "bun:test";
import type { Annotation } from "@cueloop/schema";
import { diffRowText, fileChangeCounts, marksByRows, type DiffRow } from "../view-diff";
import type { IntralineRun } from "../diff-intraline";
import type { SyntaxSpan } from "../diff-syntax";
import { DARK } from "../theme";
import { coloredRowSpans } from "./diff-sheet-layout";

function row(kind: DiffRow["kind"], text: string, extra: Partial<DiffRow> = {}): DiffRow {
  return { kind, text, file: "a.ts", ...extra };
}

function annotation(id: string, anchor: Annotation["anchor"]): Annotation {
  return { id, kind: "comment", body: "note", anchor, createdAt: "2026-01-01T00:00:00Z" };
}

describe("diffRowText", () => {
  test("strips the trailing newline the patch carries", () => {
    // Arrange / Act / Assert
    expect(diffRowText(row("add", "const x = 1;\n"))).toBe("const x = 1;");
  });
});

describe("fileChangeCounts", () => {
  test("tallies added and removed lines per file, ignoring context and headers", () => {
    // Arrange
    const rows = [
      row("file", "a.ts"),
      row("hunk", "@@"),
      row("ctx", "unchanged"),
      row("del", "gone"),
      row("add", "one"),
      row("add", "two"),
      row("file", "b.ts", { file: "b.ts" }),
      row("add", "only add", { file: "b.ts" }),
    ];

    // Act
    const counts = fileChangeCounts(rows);

    // Assert
    expect(counts.get("a.ts")).toEqual({ additions: 2, deletions: 1 });
    expect(counts.get("b.ts")).toEqual({ additions: 1, deletions: 0 });
  });
});

describe("marksByRows", () => {
  const rows = [
    row("file", "a.ts"),
    row("hunk", "@@"),
    row("ctx", "keep\n"),
    row("add", "const items = new Map();\n"),
    row("add", "return items;\n"),
  ];

  test("a whole-row quote (the legacy row anchor) marks that row end to end", () => {
    // Act
    const marks = marksByRows(
      [annotation("a1", { quote: "return items;", prefix: "", suffix: "" })],
      rows,
    );

    // Assert
    expect([...marks.keys()]).toEqual([4]);
    expect(marks.get(4)![0]).toMatchObject({ start: 0, end: 13, annotationId: "a1" });
  });

  test("a word quote marks only its characters and carries the span", () => {
    // Act
    const marks = marksByRows(
      [annotation("a1", { quote: "new Map()", prefix: "const items = ", suffix: ";" })],
      rows,
    );

    // Assert
    const mark = marks.get(3)![0]!;

    expect(mark.start).toBe(14);
    expect(mark.end).toBe(23);
    expect(mark.span).toEqual({
      start: { blockIndex: 3, char: 14 },
      end: { blockIndex: 3, char: 23 },
    });
  });

  test("a quote across two rows paints a mark on each row with one shared span", () => {
    // Arrange - the anchor a two-row drag produces: rows joined by the block separator
    const marks = marksByRows(
      [
        annotation("a1", {
          quote: "Map();\n\nreturn",
          prefix: "const items = new ",
          suffix: " items;",
          blockIndex: 3,
          start: 18,
          end: 6,
          endBlockIndex: 4,
        }),
      ],
      rows,
    );

    // Assert
    expect([...marks.keys()].toSorted()).toEqual([3, 4]);
    expect(marks.get(3)![0]!.span).toEqual(marks.get(4)![0]!.span);
    expect(marks.get(3)![0]).toMatchObject({ start: 18, end: 24 });
    expect(marks.get(4)![0]).toMatchObject({ start: 0, end: 6 });
  });

  test("the focused annotation wears the focus role", () => {
    // Act
    const marks = marksByRows(
      [annotation("a1", { quote: "keep", prefix: "", suffix: "" })],
      rows,
      "a1",
    );

    // Assert
    expect(marks.get(2)![0]!.role).toBe("mark-focus");
  });
});

describe("coloredRowSpans", () => {
  test("a changed word keeps the diff color while unchanged text dims", () => {
    // Arrange - "old" is the change, " tail" unchanged, on a modified line
    const runs: IntralineRun[] = [
      { text: "old", changed: true },
      { text: " tail", changed: false },
    ];

    // Act
    const spans = coloredRowSpans("old tail", runs, undefined, DARK.deletedForeground, DARK);

    // Assert
    expect(spans).toEqual([
      { text: "old", foreground: DARK.deletedForeground },
      { text: " tail", foreground: DARK.textDim },
    ]);
  });

  test("syntax color applies to unchanged text when there is no intra-line run", () => {
    // Arrange - a keyword span over the whole word, no intra-line runs
    const syntax: SyntaxSpan[] = [{ start: 0, end: 6, group: "keyword" }];

    // Act
    const spans = coloredRowSpans("return", undefined, syntax, DARK.textMuted, DARK);

    // Assert
    expect(spans).toEqual([{ text: "return", foreground: DARK.accent }]);
  });
});
