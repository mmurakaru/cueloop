import { describe, expect, test } from "bun:test";
import { truncateTitle } from "./truncate-title";

describe("truncateTitle", () => {
  test("a title that fits is returned unchanged", () => {
    expect(truncateTitle("short", 20)).toBe("short");
  });

  test("a long title is clipped to the width with a trailing ellipsis", () => {
    const clipped = truncateTitle("Review the accent change in the theme", 20);

    expect(clipped).toHaveLength(20);
    expect(clipped.endsWith("…")).toBe(true);
    expect(clipped).toBe("Review the accent c…");
  });

  test("newlines collapse to spaces so the row never wraps", () => {
    expect(truncateTitle("line one\nline two", 40)).toBe("line one line two");
  });

  test("a zero width yields an empty string", () => {
    expect(truncateTitle("anything", 0)).toBe("");
  });
});
