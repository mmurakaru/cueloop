/** The changed-files tree navigates by keyboard when focused: j/k move the cursor, Enter folds a folder
 * or opens a file. */

import { test, expect } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ScrollBoxRenderable, TextRenderable, type Renderable } from "@opentui/core";
import type { DiffFileContents } from "@cueloop/schema";
import { ChangesFileTree } from "./ChangesColumn";
import { settle, waitForText } from "../../testing/test-support";
import { DARK } from "../../appearance/theme";

function findById(node: Renderable, id: string): Renderable | undefined {
  if (node.id === id) return node;

  for (const child of node.getChildren()) {
    const found = findById(child, id);

    if (found) return found;
  }

  return undefined;
}

const file = (path: string): DiffFileContents => ({
  path,
  oldContents: "",
  newContents: "x",
  status: "modified",
});

const files = [file("src/a.ts"), file("src/b.ts")];

test("j moves onto a file and Enter opens it", async () => {
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
  setup.mockInput.pressKey("RETURN");
  await settle(setup);

  expect(opened).toEqual(["src/a.ts"]);

  setup.renderer.destroy();
});

test("Tab leaves the focused tree without opening a file", async () => {
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

  await waitForText(setup, "a.ts");
  setup.mockInput.pressKey("j");
  setup.mockInput.pressKey("TAB");
  await settle(setup);
  expect(opened).toEqual([]);
  setup.renderer.destroy();
});

test("keyboard navigation reveals the selected changed file", async () => {
  const manyFiles = Array.from({ length: 35 }, (_, index) =>
    file(`file-${String(index).padStart(2, "0")}.ts`),
  );
  const setup = await testRender(
    <ChangesFileTree files={manyFiles} onSelectFile={() => {}} focused theme={DARK} />,
    { width: 28, height: 8 },
  );

  await waitForText(setup, "file-00.ts");
  const scrollbox = findById(setup.renderer.root, "tree-scroll");

  if (!(scrollbox instanceof ScrollBoxRenderable)) throw new Error("tree scrollbox missing");

  const scrollSteps: number[] = [];

  for (const [index, key] of Array.from({ length: 15 }, () => "j").entries()) {
    const before = scrollbox.scrollTop;

    setup.mockInput.pressKey(key);
    // eslint-disable-next-line no-await-in-loop
    await settle(setup);
    scrollSteps.push(scrollbox.scrollTop - before);
    const row = scrollbox.content.findDescendantById(
      `tree-row-file-${String(index + 1).padStart(2, "0")}.ts`,
    );

    expect(row?.y).toBeGreaterThanOrEqual(scrollbox.viewport.y);
    expect(row?.y).toBeLessThan(scrollbox.viewport.y + scrollbox.viewport.height);
  }

  expect(scrollbox.scrollTop).toBeGreaterThan(0);
  expect(Math.max(...scrollSteps)).toBe(1);
  expect(setup.captureCharFrame()).toContain("file-15.ts");
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
  setup.mockInput.pressKey("RETURN");
  await settle(setup);
  expect(opened).toEqual([]);

  setup.renderer.destroy();
});

test("a selected long filename has no empty continuation row", async () => {
  for (const width of [33, 32, 31, 30, 29, 28, 27, 26, 25, 24]) {
    const setup = await testRender(
      <ChangesFileTree
        files={[
          file("packages/client/src/App.workbench.test.tsx"),
          file("packages/client/src/next.ts"),
        ]}
        onSelectFile={() => {}}
        focused
        theme={DARK}
      />,
      { width, height: 12 },
    );

    await settle(setup);
    setup.mockInput.pressKey("j");
    await settle(setup);
    const frame = setup.captureCharFrame().split("\n");
    const selectedLine = frame.findIndex((line) => line.includes("App.wor"));
    const row = findById(
      setup.renderer.root,
      "tree-row-packages/client/src/App.workbench.test.tsx",
    );

    expect(selectedLine).toBeGreaterThanOrEqual(0);
    expect(frame[selectedLine + 1]).toContain("next.ts");
    expect(row?.height).toBe(1);
    setup.renderer.destroy();
  }
});

test("horizontal name scrolling reveals the final extension beside the status", async () => {
  const path = "src/sidebar-scroll.test.tsx";
  const setup = await testRender(
    <ChangesFileTree files={[file(path)]} onSelectFile={() => {}} focused theme={DARK} />,
    { width: 24, height: 8 },
  );

  await waitForText(setup, "src");
  const label = findById(setup.renderer.root, `tree-label-${path}`);

  if (!(label instanceof TextRenderable)) throw new Error("file label missing");

  expect(label.maxScrollX).toBeGreaterThan(0);
  label.scrollX = label.maxScrollX;
  await settle(setup);
  expect(setup.captureCharFrame()).toContain(".tsx");
  setup.renderer.destroy();
});
