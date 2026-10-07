/** Keyboard scroll is smooth: the caret-follow reveal never scrolls the caret off screen, nor rebounds. */

import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import type { Annotation } from "@cueloop/schema";
import { DiffContentView } from "./DiffContentView";
import { diffRows, marksByRows } from "../view-diff";
import { DARK } from "../../appearance/theme";
import { annotationPaletteFor } from "../../annotations/annotation-palette";
import { press, settle, typeText } from "../../testing/test-support";
import { fixtureDiffSession } from "../../stories/story-fixtures";

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
    <DiffContentView
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

  for (let step = 0; step < codeRowCount; step++) {
    await setup.waitForVisualIdle();
    scrollTops.push(scrollbox.scrollTop);
    screenRows.push(caretScreenRow());
    await press(setup, "down");
  }

  // A key advances the viewport by at most one visual line, even across a tall card.
  for (let step = 1; step < scrollTops.length; step++) {
    expect(scrollTops[step]!).toBeGreaterThanOrEqual(scrollTops[step - 1]!);
    expect(scrollTops[step]! - scrollTops[step - 1]!).toBeLessThanOrEqual(1);
  }

  // Walk back through the same cards: upward reveal must also stay one row at a time.
  const upwardTops: number[] = [];

  for (let step = 0; step < codeRowCount + 20; step++) {
    upwardTops.push(scrollbox.scrollTop);
    screenRows.push(caretScreenRow());
    await press(setup, "up");
  }

  for (let step = 1; step < upwardTops.length; step++) {
    expect(upwardTops[step]!).toBeLessThanOrEqual(upwardTops[step - 1]!);
    expect(upwardTops[step - 1]! - upwardTops[step]!).toBeLessThanOrEqual(1);
  }

  // Assert - the caret never scrolls off screen while it walks past each wrapped card
  expect(screenRows.every((row) => row >= 0)).toBe(true);
  // and the walk did scroll: the tall diff does not fit the viewport
  expect(scrollTops[scrollTops.length - 1]!).toBeGreaterThan(0);

  setup.renderer.destroy();
}, 25000);

test("wheel input accelerates a continuous gesture and settles back to precise steps", async () => {
  const rows = diffRows(tallPatch(80));
  const setup = await testRender(
    <DiffContentView
      rows={rows}
      session={fixtureDiffSession()}
      marks={marksByRows([], rows)}
      quickActions={[]}
      observer={false}
      onAnnotate={noop}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
    />,
    { width: 60, height: 12 },
  );

  await settle(setup);
  const found = findById(setup.renderer.root, "diff-scroll");

  if (!(found instanceof ScrollBoxRenderable)) throw new Error("diff-scroll is not a scrollbox");

  const scrollbox = found;
  const acceleration = scrollbox.scrollAcceleration;
  const first = acceleration.tick(1000);
  const burst = Array.from({ length: 10 }, (_, index) => acceleration.tick(1016 + index * 16));
  const tail = acceleration.tick(1400);

  expect(scrollbox.verticalScrollBar.scrollStep).toBe(1);
  expect(first).toBe(1);
  expect(Math.max(...burst)).toBeGreaterThan(first);
  expect(tail).toBe(1);

  acceleration.reset();
  await setup.mockMouse.scroll(20, 5, "down");
  await settle(setup);
  expect(scrollbox.scrollTop).toBeGreaterThan(0);

  setup.renderer.destroy();
});

test("wheel scrolling up keeps the caret on the bottom visible code row", async () => {
  const rows = diffRows(tallPatch(80));
  const setup = await testRender(
    <DiffContentView
      rows={rows}
      session={fixtureDiffSession()}
      marks={marksByRows([], rows)}
      quickActions={[]}
      observer={false}
      onAnnotate={noop}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
    />,
    { width: 60, height: 12 },
  );

  await settle(setup);
  const found = findById(setup.renderer.root, "diff-scroll");

  if (!(found instanceof ScrollBoxRenderable)) throw new Error("diff-scroll is not a scrollbox");

  const scrollbox = found;

  for (const key of Array.from({ length: 30 }, () => "down" as const)) {
    // eslint-disable-next-line no-await-in-loop
    await press(setup, key);
  }
  const before = scrollbox.scrollTop;
  const markerRows = (): number[] =>
    setup
      .captureCharFrame()
      .split("\n")
      .flatMap((line, row) => (line.includes("▎") ? [row] : []));
  const top = scrollbox.viewport.screenY;
  const bottom = top + scrollbox.viewport.height - 1;

  for (const direction of Array.from({ length: 8 }, () => "up" as const)) {
    // eslint-disable-next-line no-await-in-loop
    await setup.mockMouse.scroll(20, 5, direction);
    // eslint-disable-next-line no-await-in-loop
    await settle(setup);
    expect(markerRows()).toEqual([bottom]);
  }
  expect(scrollbox.scrollTop).toBeLessThan(before);
  for (const direction of Array.from({ length: 20 }, () => "down" as const)) {
    // eslint-disable-next-line no-await-in-loop
    await setup.mockMouse.scroll(20, 5, direction);
    // eslint-disable-next-line no-await-in-loop
    await settle(setup);
    expect(markerRows()).toHaveLength(1);
  }
  expect(markerRows()).toEqual([top]);
  setup.renderer.destroy();
});

test("rapid wheel scrolling through a large wrapped diff does not loop React updates", async () => {
  const filePatches = Array.from({ length: 80 }, (_, fileIndex) => [
    `diff --git a/file-${fileIndex}.ts b/file-${fileIndex}.ts`,
    `--- a/file-${fileIndex}.ts`,
    `+++ b/file-${fileIndex}.ts`,
    "@@ -0,0 +1,12 @@",
    ...Array.from(
      { length: 12 },
      (_, lineIndex) => `+line ${lineIndex} ${"dense source text ".repeat(80)}`,
    ),
  ]).flat();
  const rows = diffRows([...filePatches, ""].join("\n"));
  const StatefulDiff = (): React.ReactNode => {
    const [, setCursor] = React.useState(0);

    return (
      <DiffContentView
        rows={rows}
        session={fixtureDiffSession()}
        marks={marksByRows([], rows)}
        quickActions={[]}
        observer={false}
        onCursorChange={setCursor}
        onAnnotate={noop}
        onReply={noop}
        onUpdateAnnotation={noop}
        onExit={noop}
      />
    );
  };
  const setup = await testRender(<StatefulDiff />, { width: 60, height: 12 });

  await settle(setup);
  const found = findById(setup.renderer.root, "diff-scroll");

  if (!(found instanceof ScrollBoxRenderable)) throw new Error("diff-scroll is not a scrollbox");

  for (const [index, direction] of Array.from({ length: 240 }, () => "down" as const).entries()) {
    // eslint-disable-next-line no-await-in-loop
    await setup.mockMouse.scroll(20, 5, direction);

    if (index % 12 === 0) {
      // eslint-disable-next-line no-await-in-loop
      await settle(setup);
    }
  }
  await settle(setup);
  expect(found.scrollTop).toBeGreaterThan(0);
  setup.renderer.destroy();
}, 60000);

test("walking long wrapped code lines advances the viewport one visual row per key", async () => {
  const lines = Array.from(
    { length: 36 },
    (_, index) =>
      `+line ${String(index).padStart(2, "0")} ${"a paragraph with several wrapped phrases ".repeat(5)}`,
  );
  const rows = diffRows(
    [
      "diff --git a/long.md b/long.md",
      "--- a/long.md",
      "+++ b/long.md",
      "@@ -0,0 +1,36 @@",
      ...lines,
      "",
    ].join("\n"),
  );
  const setup = await testRender(
    <DiffContentView
      rows={rows}
      session={fixtureDiffSession()}
      marks={marksByRows([], rows)}
      quickActions={[]}
      observer={false}
      onAnnotate={noop}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
    />,
    { width: 60, height: 12 },
  );

  await settle(setup);
  const found = findById(setup.renderer.root, "diff-scroll");

  if (!(found instanceof ScrollBoxRenderable)) throw new Error("diff-scroll is not a scrollbox");

  const scrollbox = found;
  const steps: number[] = [];
  const caretCell = annotationPaletteFor(DARK).caretCell;

  for (let index = 0; index < 45; index++) {
    const before = scrollbox.scrollTop;

    await press(setup, "down");
    steps.push(scrollbox.scrollTop - before);
    const caretRow = setup
      .captureSpans()
      .lines.findIndex((line) => line.spans.some((span) => hex(span.bg) === caretCell));
    const markerRows = setup
      .captureCharFrame()
      .split("\n")
      .flatMap((line, row) => (line.includes("▎") ? [row] : []));

    expect(caretRow).toBeGreaterThanOrEqual(0);
    expect(markerRows).toEqual([caretRow]);
  }

  expect(Math.max(...steps)).toBeLessThanOrEqual(1);
  expect(steps.some((step) => step > 0)).toBe(true);
  await setup.mockMouse.scroll(20, 5, "up");
  await settle(setup);
  const wrappedMarkerRows = setup
    .captureCharFrame()
    .split("\n")
    .flatMap((line, row) => (line.includes("▎") ? [row] : []));

  expect(wrappedMarkerRows).toEqual([scrollbox.viewport.screenY + scrollbox.viewport.height - 1]);
  setup.renderer.destroy();
});

test("opening a comment on the diff's last line reveals its composer", async () => {
  const rows = diffRows(tallPatch(24));
  const setup = await testRender(
    <DiffContentView
      rows={rows}
      session={fixtureDiffSession()}
      marks={marksByRows([], rows)}
      quickActions={[]}
      observer={false}
      onAnnotate={noop}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
    />,
    { width: 60, height: 10 },
  );

  await settle(setup);
  for (let step = 0; step < rows.length + 2; step++) {
    // eslint-disable-next-line no-await-in-loop
    await press(setup, "down");
  }
  await typeText(setup, "bottom comment");

  expect(setup.captureCharFrame()).toContain("● bottom comment");
  setup.renderer.destroy();
}, 25000);

test("Up keeps the caret on the first screen row while wrapped lines scroll", async () => {
  const lines = Array.from({ length: 24 }, (_, index) =>
    index % 3 === 2 ? "-" : `-line ${index} ${"wrapped words here ".repeat(5)}`,
  );
  const rows = diffRows(
    [
      "diff --git a/long.md b/long.md",
      "--- a/long.md",
      "+++ /dev/null",
      "@@ -1,24 +0,0 @@",
      ...lines,
      "",
    ].join("\n"),
  );
  const setup = await testRender(
    <DiffContentView
      rows={rows}
      session={fixtureDiffSession()}
      marks={marksByRows([], rows)}
      quickActions={[]}
      observer={false}
      onAnnotate={noop}
      onReply={noop}
      onUpdateAnnotation={noop}
      onExit={noop}
    />,
    { width: 60, height: 12 },
  );

  await settle(setup);
  const found = findById(setup.renderer.root, "diff-scroll");

  if (!(found instanceof ScrollBoxRenderable)) throw new Error("diff-scroll is not a scrollbox");

  const scrollbox = found;

  for (let index = 0; index < 40; index++) await press(setup, "down");
  let previousTop = scrollbox.scrollTop;
  let scrolled = false;

  for (let index = 0; index < 80; index++) {
    await press(setup, "up");
    const frame = setup.captureCharFrame().split("\n");
    const marker = frame.findIndex((line) => line.includes("▎"));
    const top = scrollbox.scrollTop;

    expect(previousTop - top).toBeLessThanOrEqual(1);

    if (top < previousTop) {
      expect(marker).toBe(0);
      scrolled = true;
    }

    previousTop = top;
  }
  expect(scrolled).toBe(true);
  setup.renderer.destroy();
});
