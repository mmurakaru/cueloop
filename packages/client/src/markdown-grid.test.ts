import { describe, expect, test } from "bun:test";
import {
  layoutFrontmatterGrid,
  layoutMarkdownTable,
  parseFrontmatterRows,
  parseMarkdownTable,
} from "./markdown-grid";

/** The plain text of a grid line, segments concatenated. */
function lineText(line: { text: string }[]): string {
  return line.map((segment) => segment.text).join("");
}

describe("parseMarkdownTable", () => {
  test("reads header cells, alignments, and body rows", () => {
    const table = parseMarkdownTable("| Name | Size |\n| :--- | ---: |\n| a | 1 |\n| bb | 22 |");

    expect(table.header).toEqual(["Name", "Size"]);
    expect(table.aligns).toEqual(["left", "right"]);
    expect(table.rows).toEqual([
      ["a", "1"],
      ["bb", "22"],
    ]);
  });

  test("center alignment reads from a :---: delimiter", () => {
    expect(parseMarkdownTable("| a |\n| :---: |\n| x |").aligns).toEqual(["center"]);
  });
});

describe("layoutMarkdownTable", () => {
  test("bolds the header, rules under it, and right-aligns a numeric column", () => {
    const lines = layoutMarkdownTable(
      parseMarkdownTable("| Name | Size |\n| --- | ---: |\n| a | 1 |"),
    );

    expect(lines[0]![0]!.bold).toBe(true);
    expect(lineText(lines[0]!)).toBe("Name  Size");
    expect(lines[1]![0]!.dim).toBe(true);
    expect(lineText(lines[1]!)).toBe("─".repeat("Name  Size".length));
    // "a" padded to the "Name" column, "1" right-aligned under "Size"
    expect(lineText(lines[2]!)).toBe("a" + " ".repeat(8) + "1");
  });
});

describe("parseFrontmatterRows", () => {
  test("splits top-level key: value pairs", () => {
    expect(parseFrontmatterRows("title: Plan\nowner: me")).toEqual([
      { key: "title", value: "Plan" },
      { key: "owner", value: "me" },
    ]);
  });

  test("folds an indented continuation into the row above", () => {
    expect(parseFrontmatterRows("tags:\n  - one\n  - two")).toEqual([
      { key: "tags", value: "- one\n- two" },
    ]);
  });
});

describe("layoutFrontmatterGrid", () => {
  test("draws a full border with a bold key and a rule between rows", () => {
    const lines = layoutFrontmatterGrid(
      [
        { key: "title", value: "Plan" },
        { key: "owner", value: "me" },
      ],
      40,
    );

    expect(lineText(lines[0]!).startsWith("┌")).toBe(true);
    expect(lineText(lines.at(-1)!).startsWith("└")).toBe(true);
    // the key cell is bold, the border pieces are dim
    const firstRow = lines[1]!;

    expect(firstRow.find((segment) => segment.text.includes("title"))!.bold).toBe(true);
    expect(firstRow[0]!.dim).toBe(true);
    // a divider separates the two rows
    expect(lines.some((line) => lineText(line).startsWith("├"))).toBe(true);
  });

  test("wraps a long value across cell lines, keeping the key on the first", () => {
    const lines = layoutFrontmatterGrid([{ key: "desc", value: "one two three four five" }], 24);
    const bodyLines = lines.filter((line) => lineText(line).startsWith("│"));

    expect(bodyLines.length).toBeGreaterThan(1);
    expect(bodyLines[0]!.some((segment) => segment.text.includes("desc"))).toBe(true);
    // the continuation line keeps the key column blank
    expect(bodyLines[1]!.some((segment) => segment.text.includes("desc"))).toBe(false);
  });
});
