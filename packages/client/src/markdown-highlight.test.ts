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
  test("a heading dims its marker and colors the text", () => {
    expect(painted("## Rollout Plan")).toEqual([
      { text: "## ", group: "marker" },
      { text: "Rollout Plan", group: "heading" },
    ]);
  });

  test("bold dims the delimiters and colors the inner run", () => {
    expect(painted("ship **now** please")).toContainEqual({ text: "**", group: "marker" });
    expect(painted("ship **now** please")).toContainEqual({ text: "now", group: "strong" });
  });

  test("emphasis and inline code each color their inner run", () => {
    expect(painted("an _idea_ here")).toContainEqual({ text: "idea", group: "emphasis" });
    expect(painted("call `run()` now")).toContainEqual({ text: "run()", group: "code" });
  });

  test("a link colors the text and dims the brackets and href wrapper", () => {
    const runs = painted("see [docs](https://x.dev)");

    expect(runs).toContainEqual({ text: "docs", group: "link" });
    expect(runs).toContainEqual({ text: "[", group: "marker" });
    expect(runs).toContainEqual({ text: "](https://x.dev)", group: "marker" });
  });

  test("list and blockquote markers get their own groups", () => {
    expect(painted("- a task")).toContainEqual({ text: "- ", group: "listMarker" });
    expect(painted("1. first")).toContainEqual({ text: "1. ", group: "listMarker" });
    expect(painted("> quoted")).toContainEqual({ text: "> ", group: "blockquote" });
  });

  test("a fenced code block paints the whole block as code", () => {
    const source = "```ts\nconst a = 1;\n```";

    expect(painted(source)).toEqual([{ text: source, group: "code" }]);
  });

  test("inline tokens inside a list item resolve against the whole source offset", () => {
    const source = "- see **this**";
    const strong = markdownHighlightRanges(source).find((range) => range.group === "strong");

    expect(strong && source.slice(strong.start, strong.end)).toBe("this");
  });

  test("a thematic break is one rule range", () => {
    expect(painted("---")).toEqual([{ text: "---", group: "rule" }]);
  });

  test("plain prose yields no ranges", () => {
    expect(markdownHighlightRanges("just words here")).toEqual([]);
  });

  test("underscores inside a word never italicize", () => {
    expect(markdownHighlightRanges("call snake_case_var here")).toEqual([]);
  });

  test("an asterisk with spaces around it is not emphasis", () => {
    expect(markdownHighlightRanges("compute 2 * 3 now")).toEqual([]);
  });

  test("underscore emphasis at word boundaries still resolves", () => {
    expect(painted("an _idea_ blooms")).toContainEqual({ text: "idea", group: "emphasis" });
  });
});
