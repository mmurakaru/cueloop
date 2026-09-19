import { describe, expect, test } from "bun:test";
import { markdownHighlightRanges, type MarkdownHighlightGroup } from "./markdown-highlight";

/** The substring a range covers, paired with its group, for readable assertions. */
function painted(source: string): Array<{ text: string; group: MarkdownHighlightGroup }> {
  return markdownHighlightRanges(source).map((range) => ({
    text: source.slice(range.start, range.end),
    group: range.group,
  }));
}

describe("markdownHighlightRanges", () => {
  test("a heading dims its marker and bolds the text without coloring it", () => {
    expect(painted("## Rollout Plan")).toEqual([
      { text: "## ", group: "marker" },
      { text: "Rollout Plan", group: "heading" },
    ]);
  });

  test("a link colors the whole [text](href) run", () => {
    expect(painted("see [docs](https://x.dev)")).toContainEqual({
      text: "[docs](https://x.dev)",
      group: "link",
    });
  });

  test("inline code grays the whole backtick span", () => {
    expect(painted("call `run()` now")).toContainEqual({ text: "`run()`", group: "code" });
  });

  test("a fenced code block grays the whole block", () => {
    const source = "```ts\nconst a = 1;\n```";

    expect(painted(source)).toEqual([{ text: source, group: "code" }]);
  });

  test("inline code inside a list item resolves against the whole source offset", () => {
    const source = "- run `cueloop dev`";
    const code = markdownHighlightRanges(source).find((range) => range.group === "code");

    expect(code && source.slice(code.start, code.end)).toBe("`cueloop dev`");
  });

  test("bold, emphasis, list markers, quotes, and rules stay plain", () => {
    expect(markdownHighlightRanges("ship **now** or _later_")).toEqual([]);
    expect(markdownHighlightRanges("- a task")).toEqual([]);
    expect(markdownHighlightRanges("> quoted line")).toEqual([]);
    expect(markdownHighlightRanges("---")).toEqual([]);
  });

  test("plain prose yields no ranges", () => {
    expect(markdownHighlightRanges("just words here")).toEqual([]);
  });
});
