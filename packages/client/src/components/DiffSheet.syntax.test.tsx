import { afterEach, beforeEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import type { RGBA } from "@opentui/core";
import React from "react";
import { DiffSheet } from "./DiffSheet";
import { diffRows } from "../view-diff";
import { DARK } from "../theme";
import { allowEventLoopUpdates } from "../test-support";

const PATCH = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,3 @@
 export class Store {
-  const limit = 100;
+  const limit = 250;
 }
`;

function hex(color: RGBA): string {
  const [red, green, blue] = color.toInts();

  return "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("");
}

beforeEach(() => allowEventLoopUpdates());
afterEach(() => allowEventLoopUpdates());

test("renders tree-sitter colors, with the changed word in the diff color on top", async () => {
  // Arrange
  const setup = await testRender(<DiffSheet rows={diffRows(PATCH)} cursor={0} annotations={[]} />, {
    width: 60,
    height: 12,
  });

  // Act
  // syntax highlighting resolves off the render path; pump until a keyword paints
  let keywordAccent = false;

  for (let attempt = 0; attempt < 60 && !keywordAccent; attempt++) {
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const line of setup.captureSpans().lines) {
      for (const span of line.spans) {
        if (span.text.includes("export") && hex(span.fg) === DARK.accent) keywordAccent = true;
      }
    }
  }

  // Assert
  expect(keywordAccent).toBe(true);
  // the intra-line changed number keeps the diff color over its syntax color
  const changedColors = new Set<string>();

  for (const line of setup.captureSpans().lines) {
    for (const span of line.spans) {
      if (span.text.includes("250")) changedColors.add(hex(span.fg));
      if (span.text.includes("100")) changedColors.add(hex(span.fg));
    }
  }
  expect(changedColors.has(DARK.insertedForeground)).toBe(true);
  expect(changedColors.has(DARK.deletedForeground)).toBe(true);

  setup.renderer.destroy();
}, 25000);
