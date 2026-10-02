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
import { changesTab, fileTab, makeGroup, splitGroup } from "./editor-grid";
import { NERD } from "../../ui/components/primitives/icons";
import { allowEventLoopUpdates } from "../../testing/test-support";

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

test("split stays in every header while zoom appears only in the upper-right group", async () => {
  const first = makeGroup([changesTab()]);
  const right = splitGroup(first, first.id, "right");
  const upperRight = splitGroup(right.tree, right.focusGroupId, "up");
  const setup = await testRender(
    <EditorGrid
      tree={upperRight.tree}
      focusedGroupId={upperRight.focusGroupId}
      onFocusGroup={() => {}}
      onActivateTab={() => {}}
      onCloseTab={() => {}}
      onSplit={() => {}}
      onZoom={() => {}}
      zoomed={false}
      renderTab={() => <text>body</text>}
    />,
    { width: 100, height: 16 },
  );

  allowEventLoopUpdates();
  await setup.waitForVisualIdle();
  const rows = setup.captureCharFrame().split("\n");
  const headers = rows.filter((row) => row.includes("split"));

  expect([...rows.join("\n").matchAll(/split/g)]).toHaveLength(3);
  expect(headers[0]).toContain(NERD.zoom);
  expect(headers[1]).not.toContain(NERD.zoom);
  expect(rows.filter((row) => row.includes(NERD.zoom))).toHaveLength(1);
  setup.renderer.destroy();
});

test("zoom keeps a full cell at the right edge of a narrow split", async () => {
  const first = makeGroup([changesTab()]);
  const split = splitGroup(first, first.id, "right");

  for (const width of [50, 51, 100]) {
    for (const zoomed of [false, true]) {
      const setup = await testRender(
        <EditorGrid
          tree={split.tree}
          focusedGroupId={split.focusGroupId}
          onFocusGroup={() => {}}
          onActivateTab={() => {}}
          onCloseTab={() => {}}
          onSplit={() => {}}
          onZoom={() => {}}
          zoomed={zoomed}
          renderTab={() => <text>body</text>}
        />,
        { width, height: 8 },
      );

      allowEventLoopUpdates();
      await setup.waitForVisualIdle();
      const header = setup.captureCharFrame().split("\n")[0]!;

      expect(header.match(/⛶/g)).toHaveLength(1);
      expect(width - header.indexOf(NERD.zoom)).toBe(2);
      setup.renderer.destroy();
    }
  }
});
