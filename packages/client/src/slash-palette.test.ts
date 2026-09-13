import { describe, expect, test } from "bun:test";
import { activeSlashToken, scoreMatch, slashFilter, type SlashItem } from "./slash-palette";

function item(name: string): SlashItem {
  return { name, description: name, body: name };
}

const ITEMS: SlashItem[] = [
  item("zoom-out-research-in-depth"),
  item("restate-simplified"),
  item("out-of-scope"),
  item("lgtm"),
];

describe("scoreMatch", () => {
  test("an exact name scores highest, then a prefix, then a subsequence", () => {
    const exact = scoreMatch("lgtm", "lgtm")!;
    const prefix = scoreMatch("lgtm-please", "lgtm")!;
    const subsequence = scoreMatch("looking-good-to-me", "lgtm")!;

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(subsequence);
  });

  test("a query whose characters are not all present, in order, does not match", () => {
    expect(scoreMatch("restate", "zzz")).toBeNull();
    expect(scoreMatch("abc", "acb")).toBeNull();
  });

  test("an empty query matches everything", () => {
    expect(scoreMatch("anything", "")).toBe(0);
  });
});

describe("slashFilter", () => {
  test("ranks a prefix match above a mere subsequence match", () => {
    const ranked = slashFilter(ITEMS, "out");

    expect(ranked[0]!.name).toBe("out-of-scope");
    expect(ranked.map((entry) => entry.name)).toContain("zoom-out-research-in-depth");
  });

  test("drops items that do not match and returns all on an empty query", () => {
    expect(slashFilter(ITEMS, "zzzz")).toEqual([]);
    expect(slashFilter(ITEMS, "")).toHaveLength(ITEMS.length);
  });
});

describe("activeSlashToken", () => {
  test("finds the caret's /word at the start or after a space, so each new / reopens the palette", () => {
    expect(activeSlashToken("/vitest-patt")).toBe("/vitest-patt");
    expect(activeSlashToken("use /vitest-patt")).toBe("/vitest-patt");
    expect(activeSlashToken("/zoom-out hello world /")).toBe("/");
  });

  test("closes on the space that ends the token, and ignores prose", () => {
    expect(activeSlashToken("/zoom-out ")).toBeNull();
    expect(activeSlashToken("just some prose")).toBeNull();
  });
});
