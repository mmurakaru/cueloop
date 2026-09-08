/**
 * Visual regression for the side-by-side split: the divider must be one unbroken
 * column with no holes on wrapped continuation lines, and the two columns must not
 * merge into each other. Rendered in a virtual terminal and asserted on the char frame.
 */

import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import React from "react";
import { DiffSheet } from "./DiffSheet";
import { diffRows } from "../view-diff";
import { allowEventLoopUpdates } from "../test-support";
import { fixtureDiffSession } from "./story-fixtures";

const noop = (): void => {};

// spaced words so each side word-wraps several visual lines, plus an unbalanced block (filler);
// spaced (not one long token) so a whole word lands on a continuation line for the assertions
const WRAPPING_PATCH = `diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1,4 +1,5 @@
 const alpha = the quick brown fox jumps over the lazy dog and then keeps running past the far edge
-const beta = old value that used to sit on this single line before the review had changed it wholly
+const beta = new value that now sits upon this single line after the review has changed it entirely
+const gamma = an added line with no deletion partner so the whole left column stays blank filler now
 export { alpha, beta };
`;

async function splitFrameLines(width: number): Promise<string[]> {
  const setup = await testRender(
    <DiffSheet
      rows={diffRows(WRAPPING_PATCH)}
      session={fixtureDiffSession()}
      marks={new Map()}
      quickActions={[]}
      observer={false}
      onAnnotate={noop}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
      split
    />,
    { width, height: 18 },
  );

  allowEventLoopUpdates();
  await setup.waitForVisualIdle();
  const frame = setup.captureCharFrame();

  setup.renderer.destroy();

  return frame.split("\n");
}

describe("split diff rendering", () => {
  test("the divider is one unbroken column across wrapped lines", async () => {
    // Act
    const lines = await splitFrameLines(80);
    const dividerLines = lines.filter((line) => line.includes("│"));
    const dividerColumns = new Set(dividerLines.map((line) => line.indexOf("│")));

    // Assert - every divider sits in the same column (the columns never drift or merge)
    expect(dividerColumns.size).toBe(1);
    // and the code region is contiguous: no code row is missing its divider
    const firstDivider = lines.findIndex((line) => line.includes("│"));
    const lastDivider = lines.map((line) => line.includes("│")).lastIndexOf(true);

    for (let index = firstDivider; index <= lastDivider; index++) {
      expect(lines[index]).toContain("│");
    }
  });

  test("wrapped continuation lines carry the divider, not just the first line", async () => {
    // Act - the alpha line wraps, so a late word sits on a continuation line (no gutter number)
    const lines = await splitFrameLines(80);
    const continuation = lines.find(
      (line) => line.includes("running") && !line.includes("const alpha"),
    );

    // Assert - the continuation still shows the divider
    expect(continuation).toBeDefined();
    expect(continuation).toContain("│");
  });

  test("an addition with no deletion partner keeps the divider over blank left filler", async () => {
    // Act - the gamma line has no left partner, so its left column is blank filler
    const lines = await splitFrameLines(80);
    const fillerRow = lines.find((line) => line.includes("no deletion partner"));

    // Assert - the row still has a divider, and the left of it is blank (no merged text)
    expect(fillerRow).toBeDefined();
    const dividerAt = fillerRow!.indexOf("│");

    expect(dividerAt).toBeGreaterThan(0);
    expect(fillerRow!.slice(0, dividerAt).trim()).toBe("");
  });
});
