/** The Actions editor scrolls to keep the selected row in view when the list outgrows the pane. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import type { QuickAction } from "../config";
import { settle } from "../test-support";
import { QuickActionsEditor } from "./quick-actions-editor";

const MANY: QuickAction[] = Array.from({ length: 14 }, (_, index) => ({
  prompt: `Action number ${index}`,
}));

async function mount(selectedIndex: number) {
  const setup = await testRender(
    <QuickActionsEditor
      actions={MANY}
      selectedIndex={selectedIndex}
      expandedIndex={null}
      onToggleExpand={() => {}}
      onEditMetadata={() => {}}
      onReset={() => {}}
      onAdd={() => {}}
    />,
    { width: 60, height: 10 },
  );

  await settle(setup);
  await settle(setup);
  await settle(setup);
  await settle(setup);

  return setup;
}

describe("QuickActionsEditor scrolling", () => {
  test("a list too long for the pane clips into the scroll area instead of overlapping rows", async () => {
    const setup = await mount(0);
    const lines = setup.captureCharFrame().split("\n");

    // the top rows read cleanly on their own lines - the overflow no longer paints rows on top of each other
    expect(lines.some((line) => line.includes("Action number 0"))).toBe(true);
    expect(lines.some((line) => line.includes("Action number 1"))).toBe(true);
    // a bottom row is scrolled out of the clipped pane, not overlaid onto a visible one
    expect(setup.captureCharFrame()).not.toContain("Action number 13");

    setup.renderer.destroy();
  });
});
