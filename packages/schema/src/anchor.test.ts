import { describe, expect, test } from "bun:test";
import { parseBlocks } from "./markdown";
import { makeAnchor, resolveAnchor } from "./anchor";

const DOC = `# Plan

## Context

Review sessions currently live only in daemon memory. If the daemon crashes,
every pending annotation is lost.

## Storage

Sessions are written as one JSON document per session. Sessions are written
atomically.
`;

function blocksOf(md: string) {
  return parseBlocks(md);
}

describe("anchor cascade", () => {
  test("makeAnchor captures quote + context selectors", () => {
    const blocks = blocksOf(DOC);
    const ctxIdx = blocks.findIndex((b) => b.text.startsWith("Review sessions"));
    const a = makeAnchor(blocks, ctxIdx, 0, 15); // "Review sessions"
    expect(a.quote).toBe("Review sessions");
    expect(a.prefix).toBe("");
    expect(a.suffix.startsWith(" currently")).toBe(true);
  });

  test("resolves at the recorded position when unchanged", () => {
    const blocks = blocksOf(DOC);
    const ctxIdx = blocks.findIndex((b) => b.text.startsWith("Review sessions"));
    const a = makeAnchor(blocks, ctxIdx, 7, 15); // "sessions"
    const r = resolveAnchor(a, blocks)!;
    expect(r.blockIndex).toBe(ctxIdx);
    expect(r.start).toBe(7);
    expect(r.approximate).toBe(false);
  });

  test("survives text changes before the quote (quote search)", () => {
    const blocks = blocksOf(DOC);
    const ctxIdx = blocks.findIndex((b) => b.text.startsWith("Review sessions"));
    const a = makeAnchor(blocks, ctxIdx, 0, 15);
    const edited = blocksOf(DOC.replace("Review sessions currently", "PREFIX. Review sessions now"));
    const r = resolveAnchor(a, edited)!;
    const idx = edited.findIndex((b) => b.text.includes("Review sessions"));
    expect(r.blockIndex).toBe(idx);
    expect(edited[r.blockIndex]!.text.slice(r.start, r.end)).toBe("Review sessions");
  });

  test("prefix/suffix selectors disambiguate repeated quotes", () => {
    const blocks = blocksOf(DOC);
    const storIdx = blocks.findIndex((b) => b.text.includes("atomically"));
    // anchor on the SECOND "Sessions are written" occurrence
    const text = blocks[storIdx]!.text;
    const second = text.indexOf("Sessions are written", text.indexOf("Sessions are written") + 1);
    const a = makeAnchor(blocks, storIdx, second, second + "Sessions are written".length);
    const r = resolveAnchor(a, blocks)!;
    expect(r.start).toBe(second);
  });

  test("position hint breaks ties when context also repeats", () => {
    const md = "word word word";
    const blocks = blocksOf(md);
    const a = makeAnchor(blocks, 0, 5, 9); // middle "word"
    const r = resolveAnchor(a, blocks)!;
    expect(r.start).toBe(5);
  });

  test("trimmed-quote fallback marks the resolution approximate", () => {
    const blocks = blocksOf("some text here");
    const a = { quote: " text ", prefix: "some", suffix: "here", blockIndex: 0, start: 4, end: 10 };
    const edited = blocksOf("some\ntext\nhere");
    // " text " (with spaces) is gone, "text" survives
    const r = resolveAnchor(a, edited);
    expect(r).not.toBeNull();
    expect(r!.approximate).toBe(true);
  });

  test("orphans when the quote is gone entirely", () => {
    const blocks = blocksOf(DOC);
    const ctxIdx = blocks.findIndex((b) => b.text.startsWith("Review sessions"));
    const a = makeAnchor(blocks, ctxIdx, 0, 15);
    const edited = blocksOf(DOC.replace(/Review sessions[^\n]*\n[^\n]*/, "Completely different text."));
    expect(resolveAnchor(a, edited)).toBeNull();
  });

  test("empty quote never binds", () => {
    const blocks = blocksOf(DOC);
    expect(resolveAnchor({ quote: "", prefix: "", suffix: "" }, blocks)).toBeNull();
  });
});
