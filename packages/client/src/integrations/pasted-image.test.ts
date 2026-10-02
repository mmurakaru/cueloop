import { describe, expect, test } from "bun:test";
import { imagePlaceholder, looksLikeBinaryPaste } from "./pasted-image";

function bytesOf(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("looksLikeBinaryPaste", () => {
  test("plain text pastes stay text", () => {
    expect(looksLikeBinaryPaste(new TextEncoder().encode("just a normal comment"))).toBe(false);
  });

  test("multi-line text with tabs and newlines stays text", () => {
    expect(
      looksLikeBinaryPaste(new TextEncoder().encode("line one\n\tline two\r\nline three")),
    ).toBe(false);
  });

  test("unicode text stays text", () => {
    expect(looksLikeBinaryPaste(new TextEncoder().encode("café — naïve — 日本語 — 🎉"))).toBe(
      false,
    );
  });

  test("a PNG signature is binary", () => {
    expect(looksLikeBinaryPaste(bytesOf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      true,
    );
  });

  test("a JPEG signature is binary", () => {
    expect(looksLikeBinaryPaste(bytesOf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe(true);
  });

  test("a GIF signature is binary", () => {
    expect(looksLikeBinaryPaste(new TextEncoder().encode("GIF89a\x01\x02"))).toBe(true);
  });

  test("a WEBP signature is binary", () => {
    expect(
      looksLikeBinaryPaste(bytesOf(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)),
    ).toBe(true);
  });

  test("a NUL byte marks binary", () => {
    expect(looksLikeBinaryPaste(bytesOf(0x68, 0x69, 0x00, 0x74, 0x68, 0x65, 0x72, 0x65))).toBe(
      true,
    );
  });

  test("a burst of control bytes marks binary", () => {
    expect(looksLikeBinaryPaste(bytesOf(0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08))).toBe(
      true,
    );
  });

  test("an empty paste is not binary", () => {
    expect(looksLikeBinaryPaste(new Uint8Array())).toBe(false);
  });
});

describe("imagePlaceholder", () => {
  test("numbers each pasted image", () => {
    expect(imagePlaceholder(1)).toBe("[Image #1]");
    expect(imagePlaceholder(2)).toBe("[Image #2]");
  });
});
