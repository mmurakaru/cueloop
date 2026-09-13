import { describe, expect, test } from "bun:test";
import {
  activeSlashToken,
  isStandaloneSlashQuery,
  scoreMatch,
  slashFilter,
  type SlashItem,
} from "./slash-palette";

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
  const atEnd = (text: string) => activeSlashToken(text, text.length);

  test("finds the caret's /word at the start or after a space, so each new / reopens the palette", () => {
    expect(atEnd("/vitest-patt")).toBe("/vitest-patt");
    expect(atEnd("use /vitest-patt")).toBe("/vitest-patt");
    expect(atEnd("/zoom-out hello world /")).toBe("/");
    // an underscore is a valid skill-name character, so the token spans it
    expect(atEnd("run /my_skill")).toBe("/my_skill");
  });

  test("closes on the space that ends the token, and ignores prose", () => {
    expect(atEnd("/zoom-out ")).toBeNull();
    expect(atEnd("just some prose")).toBeNull();
  });

  test("tracks the caret, not the string end: a slash mid-draft is the active token", () => {
    // caret sits right after "/imp" in "/imp done", ignoring the trailing text
    expect(activeSlashToken("/imp done", 4)).toBe("/imp");
    // caret inside plain prose, even with a later slash token, has no active token
    expect(activeSlashToken("plain text /later", 5)).toBeNull();
  });
});

describe("isStandaloneSlashQuery", () => {
  test("true only when the whole draft is a bare /query, so prose ending in /name still saves", () => {
    expect(isStandaloneSlashQuery("/lgtm")).toBe(true);
    expect(isStandaloneSlashQuery("  /lgtm  ")).toBe(true);
    expect(isStandaloneSlashQuery("please inspect /tmp")).toBe(false);
    expect(isStandaloneSlashQuery("just prose")).toBe(false);
  });
});
