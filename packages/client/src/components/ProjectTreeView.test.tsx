/** The Project tree navigates by keyboard when focused: j/k move the cursor, tab folds a folder or
 * opens a file. */

import { test, expect } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ProjectTreeView } from "./ProjectTreeView";
import { locateText, settle, waitForText } from "../test-support";
import { DARK } from "../theme";

test("tab expands a folder, then j moves down and tab opens the file", async () => {
  const opened: string[] = [];
  const setup = await testRender(
    <ProjectTreeView
      loadFiles={async () => ["src/a.ts", "README.md"]}
      onSelectFile={(path) => opened.push(path)}
      focused
      theme={DARK}
    />,
    { width: 40, height: 12 },
  );
  await settle(setup);
  await waitForText(setup, "src");

  // cursor starts on the "src" folder; tab expands it
  setup.mockInput.pressKey("TAB");
  await waitForText(setup, "a.ts");

  // j moves onto the file, tab opens it
  setup.mockInput.pressKey("j");
  await settle(setup);
  setup.mockInput.pressKey("TAB");
  await settle(setup);

  expect(opened).toEqual(["src/a.ts"]);

  setup.renderer.destroy();
});

test("without focus the keyboard does nothing", async () => {
  const opened: string[] = [];
  const setup = await testRender(
    <ProjectTreeView
      loadFiles={async () => ["src/a.ts"]}
      onSelectFile={(path) => opened.push(path)}
      theme={DARK}
    />,
    { width: 40, height: 12 },
  );
  await settle(setup);
  await waitForText(setup, "src");

  setup.mockInput.pressKey("TAB");
  await settle(setup);
  expect(setup.captureCharFrame()).not.toContain("a.ts");
  expect(opened).toEqual([]);

  setup.renderer.destroy();
});

test("the empty project hint stays centered in the panel", async () => {
  const setup = await testRender(
    <ProjectTreeView loadFiles={async () => []} onSelectFile={() => {}} theme={DARK} />,
    { width: 40, height: 12 },
  );

  await waitForText(setup, "empty");
  const position = locateText(setup, "empty");

  expect(position.column).toBeGreaterThanOrEqual(17);
  expect(position.column).toBeLessThanOrEqual(18);
  expect(position.row).toBeGreaterThanOrEqual(5);
  expect(position.row).toBeLessThanOrEqual(6);
  setup.renderer.destroy();
});
