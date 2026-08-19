import { describe, expect, test } from "bun:test";
import { intralineRunsByRow, wordLevelChanges, type IntralineRun } from "./diff-intraline";
import type { DiffRow } from "./view-diff";

function line(kind: DiffRow["kind"], text: string): DiffRow {
  return { kind, text, file: "a.ts" };
}

function joinText(runs: IntralineRun[]): string {
  return runs.map((run) => run.text).join("");
}

function changedText(runs: IntralineRun[]): string {
  return runs
    .filter((run) => run.changed)
    .map((run) => run.text)
    .join("");
}

describe("wordLevelChanges", () => {
  test("marks only the changed word and stays whitespace-lossless", () => {
    // Arrange
    const oldText = "const foo = 1";
    const newText = "const foo = 2";

    // Act
    const changes = wordLevelChanges(oldText, newText);

    // Assert
    expect(
      changes
        .filter((change) => change.kind === "common")
        .map((change) => change.text)
        .join(""),
    ).toBe("const foo = ");
    expect(
      changes
        .filter((change) => change.kind === "removed")
        .map((change) => change.text)
        .join(""),
    ).toBe("1");
    expect(
      changes
        .filter((change) => change.kind === "added")
        .map((change) => change.text)
        .join(""),
    ).toBe("2");
    // old text reconstructs from common + removed, new text from common + added
    expect(
      changes
        .filter((change) => change.kind !== "added")
        .map((change) => change.text)
        .join(""),
    ).toBe(oldText);
    expect(
      changes
        .filter((change) => change.kind !== "removed")
        .map((change) => change.text)
        .join(""),
    ).toBe(newText);
  });
});

describe("intralineRunsByRow", () => {
  test("pairs a deletion with its addition and highlights the changed word on each side", () => {
    // Arrange
    const rows = [
      line("ctx", "unchanged"),
      line("del", "const foo = 1"),
      line("add", "const foo = 2"),
    ];

    // Act
    const runsByRow = intralineRunsByRow(rows);

    // Assert
    const deletionRuns = runsByRow.get(1)!;
    const additionRuns = runsByRow.get(2)!;
    expect(joinText(deletionRuns)).toBe("const foo = 1");
    expect(joinText(additionRuns)).toBe("const foo = 2");
    expect(changedText(deletionRuns)).toBe("1");
    expect(changedText(additionRuns)).toBe("2");
  });

  test("omits context rows and rows with no counterpart", () => {
    // Arrange
    const rows = [line("ctx", "keep me"), line("add", "brand new line")];

    // Act
    const runsByRow = intralineRunsByRow(rows);

    // Assert
    expect(runsByRow.size).toBe(0);
  });

  test("pairs only min(deletions, additions); the surplus stays a plain row", () => {
    // Arrange - two deletions, one addition
    const rows = [line("del", "alpha one"), line("del", "beta two"), line("add", "alpha ONE")];

    // Act
    const runsByRow = intralineRunsByRow(rows);

    // Assert
    expect(runsByRow.has(0)).toBe(true); // first deletion pairs with the addition
    expect(runsByRow.has(1)).toBe(false); // second deletion has no counterpart
    expect(runsByRow.has(2)).toBe(true);
    expect(changedText(runsByRow.get(0)!)).toBe("one");
    expect(changedText(runsByRow.get(2)!)).toBe("ONE");
  });

  test("a fully rewritten single line marks the whole line changed on both sides", () => {
    // Arrange - a lone deletion opposite a lone addition is unambiguously one edit
    const rows = [line("del", "aaa"), line("add", "zzz")];

    // Act
    const runsByRow = intralineRunsByRow(rows);

    // Assert
    expect(changedText(runsByRow.get(0)!)).toBe("aaa");
    expect(changedText(runsByRow.get(1)!)).toBe("zzz");
  });

  test("in a shifted block, alignment matches the real counterpart, not by position", () => {
    // Arrange - "beta gamma" is modified and an unrelated line sits at each end;
    // positional pairing would word-diff "alpha" against "beta gamma delta"
    const rows = [
      line("del", "alpha"),
      line("del", "beta gamma"),
      line("add", "beta gamma delta"),
      line("add", "zulu"),
    ];

    // Act
    const runsByRow = intralineRunsByRow(rows);

    // Assert
    // the modified pair is found and word-diffed
    expect(runsByRow.has(1)).toBe(true); // "beta gamma"
    expect(runsByRow.has(2)).toBe(true); // "beta gamma delta"
    expect(changedText(runsByRow.get(2)!).trim()).toBe("delta");
    // the genuinely unrelated lines stay whole-line
    expect(runsByRow.has(0)).toBe(false); // "alpha"
    expect(runsByRow.has(3)).toBe(false); // "zulu"
  });

  test("in a multi-line block, related positional pairs still highlight the changed word", () => {
    // Arrange - a same-shape 2x2 edit: each row lines up with its counterpart
    const rows = [
      line("del", "one two"),
      line("del", "three four"),
      line("add", "one TWO"),
      line("add", "three FOUR"),
    ];

    // Act
    const runsByRow = intralineRunsByRow(rows);

    // Assert
    expect(changedText(runsByRow.get(0)!)).toBe("two");
    expect(changedText(runsByRow.get(1)!)).toBe("four");
    expect(changedText(runsByRow.get(2)!)).toBe("TWO");
    expect(changedText(runsByRow.get(3)!)).toBe("FOUR");
  });
});
