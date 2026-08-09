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

function blocksOf(markdown: string) {
  return parseBlocks(markdown);
}

describe("anchor cascade", () => {
  test("makeAnchor captures quote + context selectors", () => {
    const blocks = blocksOf(DOC);
    const contextBlockIndex = blocks.findIndex((block) => block.text.startsWith("Review sessions"));
    const anchor = makeAnchor(blocks, contextBlockIndex, 0, 15); // "Review sessions"
    expect(anchor.quote).toBe("Review sessions");
    expect(anchor.prefix).toBe("");
    expect(anchor.suffix.startsWith(" currently")).toBe(true);
  });

  test("resolves at the recorded position when unchanged", () => {
    const blocks = blocksOf(DOC);
    const contextBlockIndex = blocks.findIndex((block) => block.text.startsWith("Review sessions"));
    const anchor = makeAnchor(blocks, contextBlockIndex, 7, 15); // "sessions"
    const resolved = resolveAnchor(anchor, blocks)!;
    expect(resolved.blockIndex).toBe(contextBlockIndex);
    expect(resolved.start).toBe(7);
    expect(resolved.approximate).toBe(false);
  });

  test("survives text changes before the quote (quote search)", () => {
    const blocks = blocksOf(DOC);
    const contextBlockIndex = blocks.findIndex((block) => block.text.startsWith("Review sessions"));
    const anchor = makeAnchor(blocks, contextBlockIndex, 0, 15);
    const edited = blocksOf(DOC.replace("Review sessions currently", "PREFIX. Review sessions now"));
    const resolved = resolveAnchor(anchor, edited)!;
    const editedBlockIndex = edited.findIndex((block) => block.text.includes("Review sessions"));
    expect(resolved.blockIndex).toBe(editedBlockIndex);
    expect(edited[resolved.blockIndex]!.text.slice(resolved.start, resolved.end)).toBe("Review sessions");
  });

  test("prefix/suffix selectors disambiguate repeated quotes", () => {
    const blocks = blocksOf(DOC);
    const storageBlockIndex = blocks.findIndex((block) => block.text.includes("atomically"));
    // anchor on the SECOND "Sessions are written" occurrence
    const text = blocks[storageBlockIndex]!.text;
    const second = text.indexOf("Sessions are written", text.indexOf("Sessions are written") + 1);
    const anchor = makeAnchor(blocks, storageBlockIndex, second, second + "Sessions are written".length);
    const resolved = resolveAnchor(anchor, blocks)!;
    expect(resolved.start).toBe(second);
  });

  test("position hint breaks ties when context also repeats", () => {
    const repeatedWords = "word word word";
    const blocks = blocksOf(repeatedWords);
    const anchor = makeAnchor(blocks, 0, 5, 9); // middle "word"
    const resolved = resolveAnchor(anchor, blocks)!;
    expect(resolved.start).toBe(5);
  });

  test("trimmed-quote fallback marks the resolution approximate", () => {
    const blocks = blocksOf("some text here");
    const anchor = { quote: " text ", prefix: "some", suffix: "here", blockIndex: 0, start: 4, end: 10 };
    const edited = blocksOf("some\ntext\nhere");
    // " text " (with spaces) is gone, "text" survives
    const resolved = resolveAnchor(anchor, edited);
    expect(resolved).not.toBeNull();
    expect(resolved!.approximate).toBe(true);
  });

  test("orphans when the quote is gone entirely", () => {
    const blocks = blocksOf(DOC);
    const contextBlockIndex = blocks.findIndex((block) => block.text.startsWith("Review sessions"));
    const anchor = makeAnchor(blocks, contextBlockIndex, 0, 15);
    const edited = blocksOf(DOC.replace(/Review sessions[^\n]*\n[^\n]*/, "Completely different text."));
    expect(resolveAnchor(anchor, edited)).toBeNull();
  });

  test("empty quote never binds", () => {
    const blocks = blocksOf(DOC);
    expect(resolveAnchor({ quote: "", prefix: "", suffix: "" }, blocks)).toBeNull();
  });
});
