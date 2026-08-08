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

function block(md: string, text: string): Block {
  return parseBlocks(md).find((b) => b.text.includes(text))!;
}

describe("sourceChunk", () => {
  test("returns the exact source lines a block occupies", () => {
    expect(sourceChunk(BASE, block(BASE, "first item"))).toBe("- first item");
    expect(sourceChunk(BASE, block(BASE, "spans two lines"))).toBe("A paragraph that\nspans two lines.");
  });

  test("code block chunk includes both fence lines", () => {
    expect(sourceChunk(BASE, block(BASE, "const x"))).toBe("```ts\nconst x = 1;\nconst y = 2;\n```");
  });
});

describe("cutBlock", () => {
  test("removes the block lines and the blank line before it", () => {
    const cut = cutBlock(BASE, block(BASE, "spans two lines"));
    expect(cut).not.toContain("spans two lines");
    expect(cut).toContain("## Context\n\n- first item");
  });

  test("cut at the start of the document leaves the leading blank line", () => {
    const cut = cutBlock(BASE, block(BASE, "Plan"));
    expect(cut).not.toContain("# Plan");
    expect(cut.trimStart().startsWith("## Context")).toBe(true);
  });

  test("cut at the end of the document keeps the rest intact", () => {
    const cut = cutBlock(BASE, block(BASE, "const x"));
    expect(cut).not.toContain("const x");
    expect(cut).toContain("- second item");
  });
});

describe("restoreBlock", () => {
  test("restoring the only cut returns undefined - back to pristine", () => {
    const li = block(BASE, "second item");
    const cut = cutBlock(BASE, li);
    // the cut block re-enters before the code fence, the next surviving block
    const next = parseBlocks(cut).find((b) => b.kind === "code");
    const restored = restoreBlock(BASE, cut, li, restoreLine(next, cut.split("\n").length));
    expect(restored).toBeUndefined();
  });

  test("restore after another edit returns the merged working copy", () => {
    const li = block(BASE, "second item");
    const edited = cutBlock(BASE, li).replace("first item", "first item reworded");
    const next = parseBlocks(edited).find((b) => b.kind === "code");
    const restored = restoreBlock(BASE, edited, li, restoreLine(next, edited.split("\n").length));
    expect(restored).toContain("- second item");
    expect(restored).toContain("first item reworded");
  });

  test("restore at the end of the document (no next block)", () => {
    const code = block(BASE, "const x");
    const cut = cutBlock(BASE, code);
    const restored = restoreBlock(BASE, cut, code, restoreLine(undefined, cut.split("\n").length));
    expect(restored).toBeUndefined();
  });

  test("restore a multi-line block round-trips to pristine", () => {
    const p = block(BASE, "spans two lines");
    const cut = cutBlock(BASE, p);
    const next = parseBlocks(cut).find((b) => b.text === "first item");
    const restored = restoreBlock(BASE, cut, p, restoreLine(next, cut.split("\n").length));
    expect(restored).toBeUndefined();
  });

  test("signature rule ignores blank-line layout but not text changes", () => {
    const li = block(BASE, "second item");
    const cut = cutBlock(BASE, li);
    const next = parseBlocks(cut).find((b) => b.kind === "code");
    const line = restoreLine(next, cut.split("\n").length);
    // extra blank lines elsewhere do not block pristine detection
    expect(restoreBlock(BASE, cut.replace("## Context", "## Context\n"), li, line)).toBeUndefined();
    // a real text change keeps the working copy alive
    const changed = restoreBlock(BASE, cut.replace("first", "1st"), li, line);
    expect(changed).toContain("1st item");
  });
});

describe("restoreLine", () => {
  test("next surviving block's start, or the line count at the end", () => {
    const li = block(BASE, "first item");
    expect(restoreLine(li, 99)).toBe(li.lineStart);
    expect(restoreLine(undefined, 99)).toBe(99);
  });
});
