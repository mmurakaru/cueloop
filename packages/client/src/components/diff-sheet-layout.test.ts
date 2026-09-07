import { describe, expect, test } from "bun:test";
import type { Annotation } from "@cueloop/schema";
import type { DiffRow } from "../view-diff";
import type { IntralineRun } from "../diff-intraline";
import type { SyntaxSpan } from "../diff-syntax";
import { DARK } from "../theme";
import {
  annotatedRowsByIndex,
  coloredRowSpans,
  rowContentOffsets,
  rowLine,
  segmentRows,
} from "./diff-sheet-layout";
import { fileChangeCounts } from "../view-diff";

function row(kind: DiffRow["kind"], text: string, extra: Partial<DiffRow> = {}): DiffRow {
  return { kind, text, file: "a.ts", ...extra };
}

function annotation(quote: string): Annotation {
  return {
    id: "a1",
    kind: "comment",
    body: "note",
    anchor: { quote, prefix: "", suffix: "" },
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("rowLine", () => {
  test("strips the trailing newline the patch carries", () => {
    // Arrange / Act / Assert
    expect(rowLine(row("add", "const x = 1;\n"))).toBe("const x = 1;");
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

describe("rowContentOffsets wrap", () => {
  test("a code row past the content width counts the visual rows it wraps into", () => {
    // Arrange - one 20-char add row, hunk header above it, content width 10
    const rows = [row("hunk", "@@"), row("add", "12345678901234567890")];
    const segments = segmentRows(rows, new Map());

    // Act - the sign prefix makes it 21 cells, so three visual rows at width 10
    const offsets = rowContentOffsets(segments, 10);

    // Assert - hunk at y0, its wrapped code row at y1
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBe(1);
  });
});

describe("annotatedRowsByIndex", () => {
  test("maps an annotation to the code row whose text matches its quote", () => {
    // Arrange
    const rows = [row("file", "a.ts"), row("ctx", "keep"), row("add", "new line")];

    // Act
    const byRow = annotatedRowsByIndex(rows, [annotation("new line")]);

    // Assert
    expect([...byRow.keys()]).toEqual([2]);
  });
});

describe("segmentRows", () => {
  test("splits header rows out and closes a chunk after an annotated row", () => {
    // Arrange
    const rows = [
      row("file", "a.ts"),
      row("hunk", "@@"),
      row("ctx", "keep"),
      row("add", "changed"),
    ];
    const annotatedByRow = new Map<number, Annotation>([[3, annotation("changed")]]);

    // Act
    const segments = segmentRows(rows, annotatedByRow);

    // Assert
    expect(segments.map((segment) => segment.kind)).toEqual(["header", "header", "chunk"]);
    const chunk = segments[2];

    expect(chunk?.kind).toBe("chunk");
    if (chunk?.kind === "chunk") expect(chunk.annotation?.id).toBe("a1");
  });

  test("closes a chunk at the compose row so a draft card can follow it", () => {
    // Arrange - two code rows, composing on the first
    const rows = [row("add", "one"), row("add", "two")];

    // Act
    const segments = segmentRows(rows, new Map(), 0);

    // Assert - the first row is its own chunk, the second a separate chunk
    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.kind === "chunk")).toBe(true);
  });
});

describe("rowContentOffsets", () => {
  test("spans a file band across three rows, then a hunk header and its annotated chunk", () => {
    // Arrange - a file band, a hunk header, one changed row carrying a card
    const rows = [row("file", "a.ts"), row("hunk", "@@"), row("add", "changed")];
    const annotatedByRow = new Map<number, Annotation>([[2, annotation("changed")]]);
    const segments = segmentRows(rows, annotatedByRow);

    // Act
    const offsets = rowContentOffsets(segments);

    // Assert - the name sits between its rules (y1), the hunk header at y3,
    // its chunk row at y4; the card would sit at y5
    expect(offsets[0]).toBe(1);
    expect(offsets[1]).toBe(3);
    expect(offsets[2]).toBe(4);
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
