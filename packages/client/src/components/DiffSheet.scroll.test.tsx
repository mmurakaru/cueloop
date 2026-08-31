/** Keyboard scroll is smooth: cursor-follow never drifts past wrapped cards. */

import { expect, test } from "bun:test";
import React, { useState } from "react";
import { testRender } from "@opentui/react/test-utils";
import { useKeyboard } from "@opentui/react";
import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import type { Annotation } from "@cueloop/schema";
import { DiffSheet } from "./DiffSheet";
import { diffRows, type DiffRow } from "../view-diff";
import { DARK } from "../theme";
import { press } from "../test-support";

/** Find a renderable by id anywhere in the tree (getRenderable is not recursive). */
function findById(node: Renderable, id: string): Renderable | undefined {
  if (node.id === id) return node;
  for (const child of node.getChildren()) {
    const found = findById(child, id);

    if (found) return found;
  }

  return undefined;
}

function hex(color: { toInts(): [number, number, number, number] }): string {
  const [red, green, blue] = color.toInts();

  return "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("");
}

/** A single-hunk patch of `count` added lines, taller than any test viewport. */
function tallPatch(count: number): string {
  const adds = Array.from(
    { length: count },
    (_, index) => `+line ${String(index).padStart(2, "0")}`,
  );

  return [
    "diff --git a/f.ts b/f.ts",
    "--- a/f.ts",
    "+++ b/f.ts",
    `@@ -0,0 +1,${count} @@`,
    ...adds,
    "",
  ].join("\n");
}

/** DiffSheet with j-driven cursor, mirroring the App's down-navigation. */
function ScrollHarness({
  rows,
  annotations,
}: {
  rows: DiffRow[];
  annotations: Annotation[];
}): React.ReactNode {
  const [cursor, setCursor] = useState(0);

  useKeyboard((key) => {
    if (key.name === "j") setCursor((current) => Math.min(rows.length - 1, current + 1));
  });

  return <DiffSheet rows={rows} cursor={cursor} annotations={annotations} />;
}

test("scrolling down past wrapped annotation cards keeps the cursor pinned and the scroll monotonic", async () => {
  // Arrange - a tall diff whose annotation bodies would wrap at this width; the
  // wrapped card is exactly the layout the cursor-follow model used to mis-measure
  const rows = diffRows(tallPatch(40));
  const longBody =
    "this is a deliberately long annotation body that would wrap across the narrow test viewport";
  const annotations: Annotation[] = [8, 16, 24].map((rowIndex) => ({
    id: `a${rowIndex}`,
    kind: "comment",
    body: longBody,
    anchor: { quote: rows[rowIndex]!.text, prefix: "", suffix: "" },
    createdAt: "2026-01-01T00:00:00Z",
  }));
  const setup = await testRender(<ScrollHarness rows={rows} annotations={annotations} />, {
    width: 60,
    height: 12,
  });

  await setup.waitForVisualIdle();
  const found = findById(setup.renderer.root, "diff-scroll");

  if (!(found instanceof ScrollBoxRenderable)) throw new Error("diff-scroll is not a scrollbox");
  const scrollbox = found;

  // the cursor row is the one painted with the cursor background
  const cursorScreenRow = (): number => {
    const lines = setup.captureSpans().lines;

    for (let index = 0; index < lines.length; index++) {
      if (lines[index]!.spans.some((span) => hex(span.bg) === DARK.cursorBackground)) return index;
    }

    return -1;
  };

  // Act - walk the cursor down through the whole diff, sampling the scroll each step
  const scrollTops: number[] = [];
  const screenRows: number[] = [];

  for (let step = 0; step < rows.length; step++) {
    scrollTops.push(scrollbox.scrollTop);
    screenRows.push(cursorScreenRow());
    await press(setup, "j");
  }

  // Assert - scrollTop only ever grows going down (never rebounds/jitters)
  for (let step = 1; step < scrollTops.length; step++) {
    expect(scrollTops[step]!).toBeGreaterThanOrEqual(scrollTops[step - 1]!);
  }

  // Assert - the cursor never scrolls off screen (the pre-fix bug walked it off
  // the viewport as it passed each wrapped card)
  expect(screenRows.every((row) => row >= 0)).toBe(true);

  // Assert - through the steady scroll region (not the initial fill, not the
  // final clamp at the content end) the cursor holds ONE stable row near the
  // bottom; pre-fix it drifted down a row per wrapped card
  const maxScroll = scrollbox.scrollHeight - scrollbox.height;
  const steadyRows = screenRows.filter(
    (_, step) => scrollTops[step]! > 0 && scrollTops[step]! < maxScroll,
  );

  expect(steadyRows.length).toBeGreaterThan(0);
  expect(new Set(steadyRows).size).toBe(1);
  const pinnedRow = steadyRows[0]!;
  const viewportBottom = scrollbox.height;

  // the cursor sits a couple of rows inside the bottom edge, per the follow rule
  expect(viewportBottom - pinnedRow).toBeGreaterThanOrEqual(2);
  expect(viewportBottom - pinnedRow).toBeLessThanOrEqual(3);

  setup.renderer.destroy();
}, 25000);
