import { describe, expect, test } from "bun:test";
import {
  applyTextCuts,
  blockCutSourceRange,
  cutBlock,
  cutTextRange,
  mergeTextCut,
  restoreTextCut,
  restoreBlock,
  restoreLine,
  sourceChunk,
} from "./working-copy";
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

  test.each(["Plan", "spans two lines", "first item", "const x"])(
    "reports the exact source interval cut from %s",
    (text) => {
      const target = block(BASE, text);
      const range = blockCutSourceRange(BASE, target);

      expect(BASE.slice(0, range.start) + BASE.slice(range.end)).toBe(cutBlock(BASE, target));
    },
  );
});

describe("cutTextRange", () => {
  test("cuts only the selected characters inside a block", () => {
    const paragraph = block(BASE, "spans two lines");
    const start = paragraph.text.indexOf("paragraph");
    const cut = cutTextRange(BASE, paragraph, start, paragraph, start + "paragraph".length);

    expect(cut).toContain("A  that\nspans two lines.");
    expect(cut).toContain("## Context");
    expect(cut).toContain("- first item");
  });

  test("preserves a list marker around a partial cut", () => {
    const item = block(BASE, "first item");
    const cut = cutTextRange(BASE, item, 0, item, "first ".length);

    expect(cut).toContain("- item");
    expect(cut).not.toContain("- first item");
  });

  test.each([
    ["heading", "# remove keep", "#  keep"],
    ["ordered list", "12. remove keep", "12.  keep"],
    ["fenced code", "```ts\nremove keep\n```", "```ts\n keep\n```"],
    ["frontmatter", "---\nname: remove keep\n---", "---\nname:  keep\n---"],
    ["table", "| remove | keep |\n| --- | --- |", "|  | keep |\n| --- | --- |"],
  ])("preserves %s source markers", (_label, source, expected) => {
    const target = block(source, "remove");
    const start = target.text.indexOf("remove");

    expect(cutTextRange(source, target, start, target, start + "remove".length)).toBe(expected);
  });

  test("cuts an exact range across marked quote lines", () => {
    const source = "> keep alpha\n> remove beta\n> keep gamma";
    const quote = parseBlocks(source)[0]!;
    const start = quote.text.indexOf("alpha");
    const end = quote.text.indexOf("keep gamma");

    const cut = cutTextRange(source, quote, start, quote, end);

    expect(cut).toBe("> keep keep gamma");
  });

  test("cuts an exact range across separate blocks", () => {
    const source = "Keep before remove this.\n\n- remove that keep after";
    const blocks = parseBlocks(source);
    const first = blocks[0]!;
    const second = blocks[1]!;
    const start = first.text.indexOf("remove");
    const end = second.text.indexOf("keep after");

    const cut = cutTextRange(source, first, start, second, end);

    expect(cut).toBe("Keep before keep after");
  });
});

describe("exact text Cuts", () => {
  test("stores and applies the selected source characters exactly", () => {
    const source = "It lands under unin Threads then in the sidebar.";
    const start = source.indexOf("under");
    const end = source.indexOf(" in the sidebar");
    const cuts = mergeTextCut(source, [], start, end);

    expect(cuts).toEqual([{ start, end, quote: "under unin Threads then" }]);
    expect(applyTextCuts(source, cuts)).toBe("It lands  in the sidebar.");
  });

  test("merges overlapping and adjacent ranges in one linear source interval", () => {
    const source = "alpha beta gamma delta";
    const first = mergeTextCut(source, [], 6, 10);
    const merged = mergeTextCut(source, first, 10, 16);

    expect(merged).toEqual([{ start: 6, end: 16, quote: "beta gamma" }]);
    expect(applyTextCuts(source, merged)).toBe("alpha  delta");
  });

  test("returns the original references for no-op ranges", () => {
    const source = "unchanged";
    const cuts = [{ start: 0, end: 2, quote: "un" }];

    expect(mergeTextCut(source, cuts, 4, 4)).toBe(cuts);
    expect(applyTextCuts(source, [])).toBe(source);
  });

  test("applies out-of-order Cuts and ignores stale or overlapping records", () => {
    const source = "alpha beta gamma";

    expect(
      applyTextCuts(source, [
        { start: 11, end: 16, quote: "gamma" },
        { start: 0, end: 5, quote: "alpha" },
        { start: 2, end: 8, quote: "stale" },
        { start: 6, end: 10, quote: "beta" },
      ]),
    ).toBe("  ");
  });

  test("restores an exact subrange without disturbing the rest of its Cut", () => {
    const source = "alpha beta gamma delta";
    const cuts = mergeTextCut(source, [], 6, 16);
    const restored = restoreTextCut(source, cuts, 11, 16);

    expect(restored).toEqual([{ start: 6, end: 11, quote: "beta " }]);
    expect(applyTextCuts(source, restored ?? [])).toBe("alpha gamma delta");
  });

  test("does not restore across separate Cuts", () => {
    const source = "alpha beta gamma delta";
    const cuts = [
      { start: 6, end: 10, quote: "beta" },
      { start: 11, end: 16, quote: "gamma" },
    ];

    expect(restoreTextCut(source, cuts, 6, 16)).toBeNull();
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
