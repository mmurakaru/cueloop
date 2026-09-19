/** The changed-files tree navigates by keyboard when focused: j/k move the cursor, tab folds a folder
 * or opens a file. */

import { test, expect } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import type { DiffFileContents } from "@cueloop/schema";
import { ChangesFileTree } from "./ChangesColumn";
import { settle, waitForText } from "../test-support";
import { DARK } from "../theme";

const file = (path: string): DiffFileContents => ({
  path,
  oldContents: "",
  newContents: "x",
  status: "modified",
});

const files = [file("src/a.ts"), file("src/b.ts")];

test("j moves onto a file and tab opens it", async () => {
  const opened: string[] = [];
  const setup = await testRender(
    <ChangesFileTree
      files={files}
      onSelectFile={(path) => opened.push(path)}
      focused
      theme={DARK}
    />,
    { width: 40, height: 12 },
  );
  await settle(setup);
  await waitForText(setup, "a.ts");

  // folders open by default; cursor starts on the "src" folder, j steps onto a.ts
  setup.mockInput.pressKey("j");
  await settle(setup);
  setup.mockInput.pressKey("TAB");
  await settle(setup);

  expect(opened).toEqual(["src/a.ts"]);

  setup.renderer.destroy();
});

test("without focus the keyboard opens nothing", async () => {
  const opened: string[] = [];
  const setup = await testRender(
    <ChangesFileTree files={files} onSelectFile={(path) => opened.push(path)} theme={DARK} />,
    { width: 40, height: 12 },
  );
  await settle(setup);
  await waitForText(setup, "a.ts");

  setup.mockInput.pressKey("j");
  setup.mockInput.pressKey("TAB");
  await settle(setup);
  expect(opened).toEqual([]);

  setup.renderer.destroy();
});
