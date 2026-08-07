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
    const blocks = parseBlocks(SAMPLE);
    expect(blocks.map((b) => b.kind)).toEqual([
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
    const code = blocks.find((b) => b.kind === "code")!;
    expect(code.lang).toBe("ts");
    expect(code.text).toBe("const x = 1;\nconst y = 2;");
    // fence lines included in the source range
    expect(code.lineEnd - code.lineStart).toBe(3);
  });

  test("multi-line paragraph keeps its text and range", () => {
    const blocks = parseBlocks(SAMPLE);
    const p = blocks.find((b) => b.kind === "p")!;
    expect(p.text).toBe("A paragraph that\nspans two lines.");
    expect(p.lineEnd - p.lineStart).toBe(1);
  });

  test("line ranges index into the source", () => {
    const lines = SAMPLE.split("\n");
    for (const b of parseBlocks(SAMPLE)) {
      if (b.kind === "code") {
        expect(lines[b.lineStart]!.startsWith("```")).toBe(true);
      } else if (b.kind === "h2") {
        expect(lines[b.lineStart]!.startsWith("## ")).toBe(true);
      }
    }
  });

  test("round-trips through blockToMd", () => {
    const blocks = parseBlocks(SAMPLE);
    let oli = 0;
    const rebuilt = blocks
      .map((b) => {
        oli = b.kind === "oli" ? oli + 1 : 0;
        return blockToMd(b, oli || 1);
      })
      .join("\n\n");
    // re-parsing the rebuild yields the same kinds and texts
    const again = parseBlocks(rebuilt);
    expect(again.map((b) => [b.kind, b.text])).toEqual(blocks.map((b) => [b.kind, b.text]));
  });

  test("unknown constructs degrade to paragraphs, no content lost", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.text).join("\n")).toContain("| a | b |");
  });
});

describe("sectionOf", () => {
  test("returns the nearest preceding heading", () => {
    const blocks = parseBlocks(SAMPLE);
    const oliIdx = blocks.findIndex((b) => b.kind === "oli");
    expect(sectionOf(blocks, oliIdx)).toBe("Steps");
    const pIdx = blocks.findIndex((b) => b.kind === "p");
    expect(sectionOf(blocks, pIdx)).toBe("Context");
  });
});
