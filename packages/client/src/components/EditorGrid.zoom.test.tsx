/**
 * Regression: the header controls (search, zoom, split) stay pinned to the right
 * edge whatever the container width parity. A lone flexGrow tab strip used to
 * underfill by a cell at even widths, dragging the zoom icon a column left when
 * zoom widened the pane; space-between pins the controls so the column is stable.
 */

import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import React from "react";
import { EditorGrid } from "./EditorGrid";
import { changesTab, fileTab, makeGroup } from "./editor-grid";
import { allowEventLoopUpdates } from "../test-support";

const grid = makeGroup([changesTab(), fileTab("App.tsx", "src/App.tsx", "diff")]);

async function zoomIconInsetFromRight(width: number, zoomed: boolean): Promise<number> {
  const setup = await testRender(
    <EditorGrid
      tree={grid}
      focusedGroupId={grid.id}
      onFocusGroup={() => {}}
      onActivateTab={() => {}}
      onCloseTab={() => {}}
      onSplit={() => {}}
      onZoom={() => {}}
      zoomed={zoomed}
      renderTab={() => <text>body</text>}
    />,
    { width, height: 6 },
  );

  allowEventLoopUpdates();
  await setup.waitForVisualIdle();
  const line = setup
    .captureCharFrame()
    .split("\n")
    .find((row) => row.includes("⛶"));
  const inset = line ? width - line.indexOf("⛶") : -1;

  setup.renderer.destroy();

  return inset;
}

describe("zoom icon position", () => {
  test("stays a fixed inset from the right edge across width parities", async () => {
    // Act - even and odd widths flip the flexGrow rounding the old layout was sensitive to
    const insets = await Promise.all([
      zoomIconInsetFromRight(100, false),
      zoomIconInsetFromRight(101, false),
      zoomIconInsetFromRight(102, false),
    ]);

    // Assert - one inset for all widths: the icon is pinned right, not drifting with parity
    expect(new Set(insets).size).toBe(1);
    expect(insets[0]).toBeGreaterThan(0);
  });

  test("does not shift when zoom becomes active", async () => {
    // Act
    const inactive = await zoomIconInsetFromRight(100, false);
    const active = await zoomIconInsetFromRight(100, true);

    // Assert - active only recolours the glyph; it must not move
    expect(active).toBe(inactive);
  });
});
