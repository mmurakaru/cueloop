import { describe, expect, test } from "bun:test";
import {
  blockRuns,
  buildDisplay,
  displayText,
  renderedOffsetFor,
  workRangeForRendered,
} from "./view-plan";

// M0 (#232): lock the renderer's current StyleRun output and offset round-trips
// before the inline-tokenizer milestones (M1-M5) change blockRuns. The snapshots
// capture today's runs, so a later milestone's diff is explicit and reviewable.
// The round-trip assertions are the durable invariant: a visible word's rendered
// selection must always recover that word's *source* (block.text) offsets, even
// once inline markers are concealed - this is what keeps quote anchors exact.

const DOC = `# Heading with **bold**

A paragraph with **strong**, *em*, \`code\`, ~~strike~~ and a [label](https://example.com).

- a list item with *emphasis*
`;

const blocks = buildDisplay(DOC);

describe("view-plan regression harness (M0)", () => {
  test("blockRuns output is stable across the representative blocks", () => {
    // Arrange / Act
    const runsByBlock = blocks.map((block) => ({
      type: block.type,
      text: displayText(block),
      runs: blockRuns(block, true),
    }));

    // Assert
    expect(runsByBlock).toMatchSnapshot();
  });

  // A visible word's source offsets survive the rendered round-trip. Holds at M0
  // (1:1 today) and must keep holding once M2 conceals markers and the rendered
  // offset shifts - the recovered work range stays the word's block.text span.
  const paragraph = blocks.find((block) => displayText(block).includes("strong"))!;
  const paragraphRuns = blockRuns(paragraph, true);
  const paragraphText = displayText(paragraph);

  for (const word of ["paragraph", "strong", "strike", "label"]) {
    test(`rendered selection of "${word}" recovers its block.text offsets`, () => {
      // Arrange
      const start = paragraphText.indexOf(word);
      const rendered = renderedOffsetFor(paragraphRuns, start);

      // Assert
      expect(rendered).not.toBeNull();
      expect(workRangeForRendered(paragraphRuns, rendered!, rendered! + word.length)).toEqual({
        start,
        end: start + word.length,
      });
    });
  }
});
