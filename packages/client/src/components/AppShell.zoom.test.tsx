/**
 * Regression: the Changes header controls keep their column when zoom hides the Thread
 * pane. Thread and Changes used to split the middle as two flexBasis-0 items, and Yoga
 * added the Changes left border on top of its share, so at even terminal widths the
 * Changes pane overflowed a cell under the Project border and the zoom icon appeared to
 * jump left on zoom. The shell now sizes the Thread pane to a whole number.
 */

import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import React from "react";
import { AppShell } from "./AppShell";
import { EditorGrid } from "./EditorGrid";
import { changesTab, makeGroup } from "./editor-grid";
import { NERD } from "./primitives/icons";
import { allowEventLoopUpdates } from "../test-support";

const grid = makeGroup([changesTab()]);

async function zoomIconColumn(
  width: number,
  zoomed: boolean,
  sidebarOpen: boolean,
): Promise<number> {
  const setup = await testRender(
    <AppShell
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => {}}
      onOpenMenu={() => {}}
      threadsPanel={<text>threads</text>}
      threadTitle="thread"
      threadPanel={<text>body</text>}
      changesOpen
      projectOpen
      onToggleChanges={() => {}}
      onToggleProject={() => {}}
      onToggleRight={() => {}}
      projectMode="changes"
      zoomHideThread={zoomed}
      projectPanel={<text>project</text>}
      changesPanel={
        <EditorGrid
          tree={grid}
          focusedGroupId={grid.id}
          onFocusGroup={() => {}}
          onActivateTab={() => {}}
          onCloseTab={() => {}}
          onSplit={() => {}}
          onZoom={() => {}}
          zoomed={zoomed}
          renderTab={() => <text>diff</text>}
        />
      }
    />,
    { width, height: 8 },
  );

  allowEventLoopUpdates();
  await setup.waitForVisualIdle();
  const column = setup.captureCharFrame().split("\n")[0]!.indexOf(NERD.zoom);

  setup.renderer.destroy();

  return column;
}

describe("zoom icon in the shell", () => {
  // even widths are where the fractional split used to overflow; odd widths never did
  for (const width of [160, 161]) {
    for (const sidebarOpen of [false, true]) {
      test(`stays in its column when zoom toggles (width ${width}, sidebar ${sidebarOpen ? "open" : "closed"})`, async () => {
        // Act
        const unzoomed = await zoomIconColumn(width, false, sidebarOpen);
        const zoomed = await zoomIconColumn(width, true, sidebarOpen);

        // Assert
        expect(unzoomed).toBeGreaterThan(0);
        expect(zoomed).toBe(unzoomed);
      });
    }
  }

  test("the icon clears the Project border by its padding in both states", async () => {
    // Act
    const setupColumns = await Promise.all([
      zoomIconColumn(160, false, false),
      zoomIconColumn(160, true, false),
    ]);

    // Assert - width 160, project pane 32: the border sits at 128 and the glyph one padding cell
    // before it, the same inset the right-sidebar icon keeps from its own edge
    for (const column of setupColumns) expect(128 - column).toBe(2);
  });
});
