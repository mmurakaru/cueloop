/**
 * Regression: file tabs keep the width of their name and the strip scrolls horizontally
 * behind the header controls when the row overflows, revealing the active tab - instead of
 * squeezing every tab and truncating its label.
 */

import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import React from "react";
import { EditorGrid, visibleTabWindow } from "./EditorGrid";
import { changesTab, fileTab, makeGroup, type EditorTab } from "./editor-grid";
import { NERD } from "./primitives/icons";
import { allowEventLoopUpdates } from "../test-support";

describe("visibleTabWindow", () => {
  const tabs: EditorTab[] = ["aaaa", "bbbb", "cccc", "dddd", "eeee"].map((name) =>
    fileTab(name, name, "diff"),
  );

  test("an unmeasured strip shows every tab", () => {
    // Arrange / Act / Assert - width 0 means the header clips until it is measured
    expect(visibleTabWindow(tabs, 0, 0, 0)).toEqual({ first: 0, end: tabs.length });
  });

  test("only the run that fits renders, and the active tab pulls the window to it", () => {
    // Arrange - each tab is 9 cells (4 label + 5 chrome); a 30-cell strip fits about three
    // Act - the last tab is active
    const window = visibleTabWindow(tabs, 0, tabs.length - 1, 30);

    // Assert - the window ends on the active tab and dropped earlier tabs
    expect(window.end).toBe(tabs.length);
    expect(window.first).toBeGreaterThan(0);
  });

  test("a tab wider than the strip still shows on its own", () => {
    // Arrange
    const wide = [fileTab("a-very-long-file-name.tsx", "x", "diff")];

    // Act / Assert
    expect(visibleTabWindow(wide, 0, 0, 10)).toEqual({ first: 0, end: 1 });
  });
});

const NAMES = [
  "AppShell.tsx",
  "DiffSheet.tsx",
  "IconButton.tsx",
  "EditorGrid.zoom.test.tsx",
  "ThreadView.tsx",
];

async function headerRow(activeIndex: number): Promise<string> {
  const group = makeGroup([
    changesTab(),
    ...NAMES.map((name) => fileTab(name, `src/${name}`, "diff")),
  ]);
  const tree = { ...group, activeTabId: group.tabs[activeIndex]!.id };
  const setup = await testRender(
    <EditorGrid
      tree={tree}
      focusedGroupId={tree.id}
      onFocusGroup={() => {}}
      onActivateTab={() => {}}
      onCloseTab={() => {}}
      onSplit={() => {}}
      onZoom={() => {}}
      zoomed={false}
      renderTab={() => <text>body</text>}
    />,
    { width: 70, height: 4 },
  );

  allowEventLoopUpdates();
  await setup.waitForVisualIdle();
  // the strip reveals the active tab on the frame after layout
  await setup.waitForVisualIdle();
  const row = setup.captureCharFrame().split("\n")[0]!;

  setup.renderer.destroy();

  return row;
}

describe("editor tab strip", () => {
  test("tabs keep their full names and the controls stay pinned when the row overflows", async () => {
    // Act
    const row = await headerRow(0);

    // Assert - no squeezed labels: every visible tab reads in full up to the clip edge
    expect(row).toContain("Changes ");
    expect(row).toContain("AppShell.tsx ");
    expect(row).toContain("DiffSheet.tsx ");
    // and the header controls sit at the right edge, past the clipped strip
    expect(row.trimEnd().endsWith(`search  ${NERD.zoom}`)).toBe(true);
  });

  test("the strip scrolls to reveal the active tab", async () => {
    // Act
    const row = await headerRow(NAMES.length);

    // Assert - the last tab is on screen, the first has scrolled out behind the left edge
    expect(row).toContain("ThreadView.tsx ");
    expect(row).not.toContain("Changes ");
  });
});
