import { describe, expect, test } from "bun:test";
import { parseBlocks, blockToMd, sectionOf } from "./markdown";

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
    expect(again.map((block) => [block.kind, block.text])).toEqual(blocks.map((block) => [block.kind, block.text]));
  });

  test("unknown constructs degrade to paragraphs, no content lost", () => {
    // Arrange
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";

    // Act
    const blocks = parseBlocks(md);

    // Assert
    expect(blocks.map((block) => block.text).join("\n")).toContain("| a | b |");
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
