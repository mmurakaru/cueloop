import { describe, expect, test } from "bun:test";
import { fadeTitle, mixHex } from "./fade-title";

describe("mixHex", () => {
  test("returns the endpoints at t=0 and t=1", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  test("blends halfway", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("clamps out-of-range t", () => {
    expect(mixHex("#101010", "#202020", 2)).toBe("#202020");
    expect(mixHex("#101010", "#202020", -1)).toBe("#101010");
  });
});

describe("fadeTitle", () => {
  test("a title that fits is one plain segment", () => {
    const segments = fadeTitle("short", 20, "#aabbcc", "#000000");

    expect(segments).toEqual([{ text: "short", fg: "#aabbcc" }]);
  });

  test("a long title is clipped to the width and its tail fades toward the background", () => {
    const segments = fadeTitle("Review the accent change in the theme", 20, "#ffffff", "#000000");

    expect(segments.map((segment) => segment.text).join("")).toHaveLength(20);
    // the head keeps the base color, the last characters step toward the fade color
    expect(segments[0]!.fg).toBe("#ffffff");
    expect(segments.at(-1)!.fg).not.toBe("#ffffff");
    // the very last character is the most faded (closest to the background)
    const lastTwo = segments.slice(-2);

    expect(mixHex("#ffffff", "#000000", 0)).not.toBe(lastTwo[1]!.fg);
  });

  test("newlines collapse to spaces so the row never wraps", () => {
    const segments = fadeTitle("line one\nline two", 40, "#ffffff", "#000000");

    expect(segments[0]!.text).toBe("line one line two");
  });

  test("a zero width yields nothing", () => {
    expect(fadeTitle("anything", 0, "#ffffff", "#000000")).toEqual([]);
  });
});
