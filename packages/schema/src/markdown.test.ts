import { describe, expect, test } from "bun:test";
import { parseBlocks, blockToMd, sectionOf, stripLeadingBlockMarker } from "./markdown";

const SAMPLE = `# Title

## Context

A paragraph that
spans two lines.

- first item
- second item

\`\`\`ts
const x = 1;
const y = 2;
\`\`\`

## Steps

1. do one
2. do two

> a quoted
> aside

---
`;

describe("parseBlocks", () => {
  test("parses every block kind with source line ranges", () => {
    // Act
    const blocks = parseBlocks(SAMPLE);

    // Assert
    expect(blocks.map((block) => block.kind)).toEqual([
      "h1",
      "h2",
      "p",
      "li",
      "li",
      "code",
      "h2",
      "oli",
      "oli",
      "quote",
      "hr",
    ]);
    const code = blocks.find((block) => block.kind === "code")!;

    expect(code.lang).toBe("ts");
    expect(code.text).toBe("const x = 1;\nconst y = 2;");
    // fence lines included in the source range
    expect(code.lineEnd - code.lineStart).toBe(3);
  });

  test("multi-line paragraph keeps its text and range", () => {
    // Arrange
    const blocks = parseBlocks(SAMPLE);
    const paragraph = blocks.find((block) => block.kind === "p")!;

    // Assert
    expect(paragraph.text).toBe("A paragraph that\nspans two lines.");
    expect(paragraph.lineEnd - paragraph.lineStart).toBe(1);
  });

  test("line ranges index into the source", () => {
    // Arrange
    const lines = SAMPLE.split("\n");

    // Assert
    for (const block of parseBlocks(SAMPLE)) {
      if (block.kind === "code") {
        expect(lines[block.lineStart]!.startsWith("```")).toBe(true);
      } else if (block.kind === "h2") {
        expect(lines[block.lineStart]!.startsWith("## ")).toBe(true);
      }
    }
  });

  test("round-trips through blockToMd", () => {
    // Arrange
    const blocks = parseBlocks(SAMPLE);
    let orderedItemCount = 0;
    const rebuilt = blocks
      .map((block) => {
        orderedItemCount = block.kind === "oli" ? orderedItemCount + 1 : 0;

        return blockToMd(block, orderedItemCount || 1);
      })
      .join("\n\n");

    // Act
    // re-parsing the rebuild yields the same kinds and texts
    const again = parseBlocks(rebuilt);

    // Assert
    expect(again.map((block) => [block.kind, block.text])).toEqual(
      blocks.map((block) => [block.kind, block.text]),
    );
  });

  test("unknown constructs degrade to paragraphs, no content lost", () => {
    // Arrange
    const md = "<div>raw html</div>";

    // Act
    const blocks = parseBlocks(md);

    // Assert
    expect(blocks.map((block) => block.kind)).toEqual(["p"]);
    expect(blocks[0]!.text).toBe("<div>raw html</div>");
  });

  test("a GFM table parses to one table block that keeps its source verbatim", () => {
    // Arrange
    const md = "before\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nafter";

    // Act
    const blocks = parseBlocks(md);

    // Assert
    expect(blocks.map((block) => block.kind)).toEqual(["p", "table", "p"]);
    const table = blocks.find((block) => block.kind === "table")!;

    expect(table.text).toBe("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |");
  });

  test("a single-column table and an aligned delimiter still parse as a table", () => {
    // Assert
    expect(parseBlocks("| only |\n| --- |\n| one |")[0]!.kind).toBe("table");
    expect(parseBlocks("| l | r |\n| :--- | ---: |\n| a | b |")[0]!.kind).toBe("table");
  });

  test("a plain rule line is an hr, never a table", () => {
    // Assert
    expect(parseBlocks("above\n\n---\n\nbelow").map((block) => block.kind)).toEqual([
      "p",
      "hr",
      "p",
    ]);
  });

  test("leading frontmatter parses to a frontmatter block, closed by its fence", () => {
    // Arrange
    const md = "---\ntitle: Plan\nowner: me\n---\n\n# Heading\n";

    // Act
    const blocks = parseBlocks(md);

    // Assert
    expect(blocks.map((block) => block.kind)).toEqual(["frontmatter", "h1"]);
    expect(blocks[0]!.text).toBe("title: Plan\nowner: me");
  });

  test("a leading fence with no closing fence stays an hr, not frontmatter", () => {
    // Assert
    expect(parseBlocks("---\njust a paragraph\n").map((block) => block.kind)).toEqual(["hr", "p"]);
  });

  test("table and frontmatter round-trip through blockToMd", () => {
    // Arrange
    const md = "---\ntitle: Plan\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    const blocks = parseBlocks(md);

    // Act
    const rebuilt = blocks.map((block) => blockToMd(block)).join("\n\n");

    // Assert
    expect(parseBlocks(rebuilt).map((block) => [block.kind, block.text])).toEqual(
      blocks.map((block) => [block.kind, block.text]),
    );
  });
});

describe("sectionOf", () => {
  test("returns the nearest preceding heading", () => {
    // Arrange
    const blocks = parseBlocks(SAMPLE);

    // Assert
    const orderedItemIndex = blocks.findIndex((block) => block.kind === "oli");

    expect(sectionOf(blocks, orderedItemIndex)).toBe("Steps");
    const paragraphIndex = blocks.findIndex((block) => block.kind === "p");

    expect(sectionOf(blocks, paragraphIndex)).toBe("Context");
  });
});

describe("stripLeadingBlockMarker", () => {
  test("strips the marker the parser strips for every marked block kind", () => {
    // Assert
    expect(stripLeadingBlockMarker("# Heading")).toBe("Heading");
    expect(stripLeadingBlockMarker("### Heading")).toBe("Heading");
    expect(stripLeadingBlockMarker("- bullet item")).toBe("bullet item");
    expect(stripLeadingBlockMarker("3. ordered item")).toBe("ordered item");
    expect(stripLeadingBlockMarker("> quoted line")).toBe("quoted line");
  });

  test("agrees with the text the parser produces", () => {
    // Arrange
    const source = "- This is a dummy plan - confirm the item";

    // Act
    const [listBlock] = parseBlocks(source);

    // Assert
    expect(stripLeadingBlockMarker(source)).toBe(listBlock!.text);
  });

  test("leaves an unmarked line untouched", () => {
    // Assert
    expect(stripLeadingBlockMarker("a plain paragraph")).toBe("a plain paragraph");
  });
});
