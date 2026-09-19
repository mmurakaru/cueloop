/** The Actions editor scrolls the list, and an expanded row edits both the title and the description. */

import { describe, expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import type { QuickAction } from "../config";
import { locateText, settle, typeText } from "../test-support";
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
      expandedField="prompt"
      onToggleExpand={() => {}}
      onEditPrompt={() => {}}
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

describe("editing an expanded action", () => {
  test("an expanded row edits both the title and the description", async () => {
    const prompts: string[] = [];
    const metadatas: string[] = [];
    const setup = await testRender(
      <QuickActionsEditor
        actions={[{ prompt: "Ship it", metadata: "be terse" }]}
        selectedIndex={0}
        expandedIndex={0}
        expandedField="prompt"
        onToggleExpand={() => {}}
        onEditPrompt={(_index, prompt) => prompts.push(prompt)}
        onEditMetadata={(_index, metadata) => metadatas.push(metadata)}
        onReset={() => {}}
        onAdd={() => {}}
      />,
      { width: 60, height: 8 },
    );

    await settle(setup);
    await settle(setup);

    await typeText(setup, "!");
    expect(prompts.at(-1)).toBe("Ship it!");

    setup.mockInput.pressKey("RETURN");
    await settle(setup);
    await typeText(setup, "X");
    expect(metadatas.at(-1)).toBe("be terseX");

    setup.renderer.destroy();
  });

  test("clicking the description row opens the editor on the metadata field directly", async () => {
    const toggles: Array<{ index: number; field: "prompt" | "metadata" }> = [];
    const setup = await testRender(
      <QuickActionsEditor
        actions={[{ prompt: "Ship it", metadata: "be terse" }]}
        selectedIndex={0}
        expandedIndex={null}
        expandedField="prompt"
        onToggleExpand={(index, field) => toggles.push({ index, field })}
        onEditPrompt={() => {}}
        onEditMetadata={() => {}}
        onReset={() => {}}
        onAdd={() => {}}
      />,
      { width: 60, height: 8 },
    );
    await settle(setup);

    // clicking the title opens the title field; clicking the description opens the metadata field
    const title = locateText(setup, "Ship it");
    await setup.mockMouse.click(title.column, title.row);
    const description = locateText(setup, "be terse");
    await setup.mockMouse.click(description.column, description.row);

    expect(toggles).toEqual([
      { index: 0, field: "prompt" },
      { index: 0, field: "metadata" },
    ]);

    setup.renderer.destroy();
  });
});
