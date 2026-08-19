import { describe, expect, test } from "bun:test";
import { cutBlock, restoreBlock, restoreLine, sourceChunk } from "./working-copy";
import { parseBlocks, type Block } from "./markdown";

const BASE = `# Plan

## Context

A paragraph that
spans two lines.

- first item
- second item

\`\`\`ts
const x = 1;
const y = 2;
\`\`\`
`;

function block(markdown: string, text: string): Block {
  return parseBlocks(markdown).find((block) => block.text.includes(text))!;
}

describe("sourceChunk", () => {
  test("returns the exact source lines a block occupies", () => {
    expect(sourceChunk(BASE, block(BASE, "first item"))).toBe("- first item");
    expect(sourceChunk(BASE, block(BASE, "spans two lines"))).toBe(
      "A paragraph that\nspans two lines.",
    );
  });

  test("code block chunk includes both fence lines", () => {
    expect(sourceChunk(BASE, block(BASE, "const x"))).toBe(
      "```ts\nconst x = 1;\nconst y = 2;\n```",
    );
  });
});

describe("cutBlock", () => {
  test("removes the block lines and the blank line before it", () => {
    // Act
    const cut = cutBlock(BASE, block(BASE, "spans two lines"));

    // Assert
    expect(cut).not.toContain("spans two lines");
    expect(cut).toContain("## Context\n\n- first item");
  });

  test("cut at the start of the document leaves the leading blank line", () => {
    // Act
    const cut = cutBlock(BASE, block(BASE, "Plan"));

    // Assert
    expect(cut).not.toContain("# Plan");
    expect(cut.trimStart().startsWith("## Context")).toBe(true);
  });

  test("cut at the end of the document keeps the rest intact", () => {
    // Act
    const cut = cutBlock(BASE, block(BASE, "const x"));

    // Assert
    expect(cut).not.toContain("const x");
    expect(cut).toContain("- second item");
  });
});

describe("restoreBlock", () => {
  test("restoring the only cut returns undefined - back to pristine", () => {
    // Arrange
    const listItem = block(BASE, "second item");
    const cut = cutBlock(BASE, listItem);
    // the cut block re-enters before the code fence, the next surviving block
    const next = parseBlocks(cut).find((candidate) => candidate.kind === "code");

    // Act
    const restored = restoreBlock(BASE, cut, listItem, restoreLine(next, cut.split("\n").length));

    // Assert
    expect(restored).toBeUndefined();
  });

  test("restore after another edit returns the merged working copy", () => {
    // Arrange
    const listItem = block(BASE, "second item");
    const edited = cutBlock(BASE, listItem).replace("first item", "first item reworded");
    const next = parseBlocks(edited).find((candidate) => candidate.kind === "code");

    // Act
    const restored = restoreBlock(
      BASE,
      edited,
      listItem,
      restoreLine(next, edited.split("\n").length),
    );

    // Assert
    expect(restored).toContain("- second item");
    expect(restored).toContain("first item reworded");
  });

  test("restore at the end of the document (no next block)", () => {
    // Arrange
    const code = block(BASE, "const x");
    const cut = cutBlock(BASE, code);

    // Act
    const restored = restoreBlock(BASE, cut, code, restoreLine(undefined, cut.split("\n").length));

    // Assert
    expect(restored).toBeUndefined();
  });

  test("restore a multi-line block round-trips to pristine", () => {
    // Arrange
    const paragraph = block(BASE, "spans two lines");
    const cut = cutBlock(BASE, paragraph);
    const next = parseBlocks(cut).find((block) => block.text === "first item");

    // Act
    const restored = restoreBlock(BASE, cut, paragraph, restoreLine(next, cut.split("\n").length));

    // Assert
    expect(restored).toBeUndefined();
  });

  test("signature rule ignores blank-line layout but not text changes", () => {
    // Arrange
    const listItem = block(BASE, "second item");
    const cut = cutBlock(BASE, listItem);
    const next = parseBlocks(cut).find((candidate) => candidate.kind === "code");
    const line = restoreLine(next, cut.split("\n").length);

    // Assert
    // extra blank lines elsewhere do not block pristine detection
    expect(
      restoreBlock(BASE, cut.replace("## Context", "## Context\n"), listItem, line),
    ).toBeUndefined();
    // a real text change keeps the working copy alive
    const changed = restoreBlock(BASE, cut.replace("first", "1st"), listItem, line);
    expect(changed).toContain("1st item");
  });
});

describe("restoreLine", () => {
  test("next surviving block's start, or the line count at the end", () => {
    // Arrange
    const listItem = block(BASE, "first item");

    // Assert
    expect(restoreLine(listItem, 99)).toBe(listItem.lineStart);
    expect(restoreLine(undefined, 99)).toBe(99);
  });
});
