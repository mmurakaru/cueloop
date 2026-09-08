/**
 * The mirrored scrollbar: thumb geometry follows the scroll state, and on a surface it
 * draws as the panel's rightmost column, past the discussion dots - not inside the
 * scrollbox's own viewport row.
 */

import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import React from "react";
import { DiffSheet } from "./DiffSheet";
import { diffRows, marksByRows } from "../view-diff";
import { allowEventLoopUpdates } from "../test-support";
import { fixtureDiffSession } from "./story-fixtures";
import { DARK } from "../theme";
import { thumbGeometry } from "./SurfaceScrollbar";

const noop = (): void => {};

function hex(color: { toInts(): [number, number, number, number] }): string {
  const [red, green, blue] = color.toInts();

  return "#" + [red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("");
}

describe("thumbGeometry", () => {
  test("nothing to scroll draws no thumb", () => {
    // Arrange / Act / Assert - content fits the viewport
    expect(thumbGeometry({ top: 0, height: 10, viewport: 14 }, 14)).toBeNull();
  });

  test("the thumb's height is the viewport's share of the content, at least one row", () => {
    // Act
    const tall = thumbGeometry({ top: 0, height: 44, viewport: 14 }, 14);
    const tiny = thumbGeometry({ top: 0, height: 10_000, viewport: 14 }, 14);

    // Assert
    expect(tall).toEqual({ row: 0, height: 4 });
    expect(tiny?.height).toBe(1);
  });

  test("the thumb reaches the track's end at the maximum scroll offset", () => {
    // Act - scrolled to the bottom
    const thumb = thumbGeometry({ top: 30, height: 44, viewport: 14 }, 14);

    // Assert - its last row is the track's last row
    expect(thumb).toEqual({ row: 10, height: 4 });
  });
});

describe("the diff sheet's scrollbar", () => {
  const body = Array.from({ length: 40 }, (_unused, index) => `+line ${index} of the change;`).join(
    "\n",
  );
  const patch = `diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -0,0 +1,40 @@\n${body}\n`;

  test("draws as the rightmost column, past the discussion dot", async () => {
    // Arrange - a diff taller than the viewport, with one discussion so the dot rail has a dot
    const rows = diffRows(patch);
    const session = fixtureDiffSession({
      annotations: [
        {
          id: "a1",
          kind: "comment",
          body: "hm",
          anchor: { quote: "line 7 of the change;", prefix: "", suffix: "" },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const width = 60;
    const setup = await testRender(
      <DiffSheet
        rows={rows}
        session={session}
        marks={marksByRows(session.annotations, rows)}
        quickActions={[]}
        observer={false}
        onAnnotate={noop}
        onReply={noop}
        onUpdateAnnotation={noop}
        onExit={noop}
      />,
      { width, height: 14 },
    );

    allowEventLoopUpdates();
    await setup.waitForVisualIdle();
    const frame = setup.captureCharFrame().split("\n");
    const thumbRows = setup.captureSpans().lines.filter((line) => {
      let column = 0;

      for (const span of line.spans) {
        column += span.text.length;
        if (column >= width) return span.bg !== undefined && hex(span.bg) === DARK.textDim;
      }

      return false;
    }).length;

    // Assert - the thumb occupies the last column at the top (scroll offset 0), and the dot sits
    // to its left in the rail, so the order reads content, dots, scrollbar
    expect(thumbRows).toBe(4);
    const dotLine = frame.find((line) => line.includes("○"));

    expect(dotLine).toBeDefined();
    expect(dotLine!.indexOf("○")).toBeLessThan(width - 1);
    // let the async highlight settle before the renderer goes away
    await new Promise((resolve) => setTimeout(resolve, 100));
    setup.renderer.destroy();
  });
});
