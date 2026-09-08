/** Keyboard scroll is smooth: the caret-follow reveal never scrolls the caret off screen, nor rebounds. */

import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import type { Annotation } from "@cueloop/schema";
import { DiffSheet } from "./DiffSheet";
import { diffRows, marksByRows } from "../view-diff";
import { DARK } from "../theme";
import { annotationPaletteFor } from "../annotation-palette";
import { press } from "../test-support";
import { fixtureDiffSession } from "./story-fixtures";

const noop = (): void => {};

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

test("walking the caret down past wrapped discussion cards keeps it on screen and the scroll monotonic", async () => {
  // Arrange - a tall diff whose comment bodies wrap at this width, so the cards
  // between rows are taller than one line
  const rows = diffRows(tallPatch(40));
  const longBody =
    "this is a deliberately long annotation body that would wrap across the narrow test viewport";
  const annotations: Annotation[] = [8, 16, 24].map((rowIndex) => ({
    id: `a${rowIndex}`,
    kind: "comment",
    body: longBody,
    anchor: { quote: rows[rowIndex]!.text.replace(/\n$/, ""), prefix: "", suffix: "" },
    createdAt: "2026-01-01T00:00:00Z",
  }));
  const setup = await testRender(
    <DiffSheet
      rows={rows}
      session={fixtureDiffSession({ annotations })}
      marks={marksByRows(annotations, rows)}
      quickActions={[]}
      observer={false}
      onAnnotate={noop}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
    />,
    { width: 60, height: 12 },
  );

  await setup.waitForVisualIdle();
  const found = findById(setup.renderer.root, "diff-scroll");

  if (!(found instanceof ScrollBoxRenderable)) throw new Error("diff-scroll is not a scrollbox");
  const scrollbox = found;
  const caretCell = annotationPaletteFor(DARK).caretCell;

  // the caret row is the one painting the caret cell
  const caretScreenRow = (): number => {
    const lines = setup.captureSpans().lines;

    for (let index = 0; index < lines.length; index++) {
      if (lines[index]!.spans.some((span) => hex(span.bg) === caretCell)) return index;
    }

    return -1;
  };

  // Act - walk the caret down through every code row, sampling the scroll each step
  const scrollTops: number[] = [];
  const screenRows: number[] = [];
  const codeRowCount = rows.filter((row) => row.kind === "add").length;

  let firstMissFrame: string | null = null;

  for (let step = 0; step < codeRowCount; step++) {
    await setup.waitForVisualIdle();
    scrollTops.push(scrollbox.scrollTop);
    screenRows.push(caretScreenRow());
    if (screenRows[step] === -1 && firstMissFrame === null) {
      firstMissFrame = setup.captureCharFrame();
    }
    await press(setup, "down");
  }

  // Assert - scrollTop only ever grows going down (never rebounds/jitters)
  for (let step = 1; step < scrollTops.length; step++) {
    expect(scrollTops[step]!).toBeGreaterThanOrEqual(scrollTops[step - 1]!);
  }

  // Assert - the caret never scrolls off screen while it walks past each wrapped card
  if (firstMissFrame !== null) {
    // CI-only failure under investigation: show the walk and the frame at the first miss
    console.log(
      `DIAG scrollTops=${JSON.stringify(scrollTops)}\nDIAG screenRows=${JSON.stringify(screenRows)}\nDIAG frame:\n${firstMissFrame}`,
    );
  }
  expect(screenRows.every((row) => row >= 0)).toBe(true);
  // and the walk did scroll: the tall diff does not fit the viewport
  expect(scrollTops[scrollTops.length - 1]!).toBeGreaterThan(0);

  setup.renderer.destroy();
}, 25000);
