/** The Project tree navigates by keyboard when focused: j/k move the cursor, Enter folds a folder or
 * opens a file. */

import { test, expect } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import { ProjectTreeView } from "./ProjectTreeView";
import { locateText, settle, waitForText, waitForTextGone } from "../../testing/test-support";
import { DARK } from "../../appearance/theme";

function findById(node: Renderable, id: string): Renderable | undefined {
  if (node.id === id) return node;
  for (const child of node.getChildren()) {
    const found = findById(child, id);

    if (found) return found;
  }

  return undefined;
}

test("Enter expands a folder, then j moves down and Enter opens the file", async () => {
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

  // cursor starts on the "src" folder; Enter expands it
  setup.mockInput.pressKey("RETURN");
  await waitForText(setup, "a.ts");

  // j moves onto the file, Enter opens it
  setup.mockInput.pressKey("j");
  await settle(setup);
  setup.mockInput.pressKey("RETURN");
  await settle(setup);

  expect(opened).toEqual(["src/a.ts"]);

  setup.renderer.destroy();
});

test("keyboard navigation reveals the selected project row", async () => {
  const paths = Array.from(
    { length: 35 },
    (_, index) => `file-${String(index).padStart(2, "0")}.ts`,
  );
  const setup = await testRender(
    <ProjectTreeView loadFiles={async () => paths} onSelectFile={() => {}} focused theme={DARK} />,
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

test("project wheel scrolling accelerates during a gesture and resets after a pause", async () => {
  const paths = Array.from(
    { length: 35 },
    (_, index) => `file-${String(index).padStart(2, "0")}.ts`,
  );
  const setup = await testRender(
    <ProjectTreeView loadFiles={async () => paths} onSelectFile={() => {}} theme={DARK} />,
    { width: 28, height: 8 },
  );

  await waitForText(setup, "file-00.ts");
  const scrollbox = findById(setup.renderer.root, "tree-scroll");

  if (!(scrollbox instanceof ScrollBoxRenderable)) throw new Error("tree scrollbox missing");
  const acceleration = scrollbox.scrollAcceleration;
  const first = acceleration.tick(1000);
  const burst = Array.from({ length: 10 }, (_, index) => acceleration.tick(1016 + index * 16));
  const tail = acceleration.tick(1400);

  expect(first).toBe(1);
  expect(Math.max(...burst)).toBeGreaterThan(first);
  expect(tail).toBe(1);
  acceleration.reset();
  await setup.mockMouse.scroll(10, 4, "down");
  await settle(setup);
  expect(scrollbox.scrollTop).toBeGreaterThan(0);
  setup.renderer.destroy();
});

test("long project filenames stay on one row without an ellipsis", async () => {
  const path = "src/ChangesFileTree.test.tsx";
  const setup = await testRender(
    <ProjectTreeView loadFiles={async () => [path]} onSelectFile={() => {}} focused theme={DARK} />,
    { width: 22, height: 8 },
  );

  await waitForText(setup, "src");
  setup.mockInput.pressKey("RETURN");
  await settle(setup);
  const frame = setup.captureCharFrame();
  const row = findById(setup.renderer.root, `tree-row-${path}`);

  expect(row?.height).toBe(1);
  expect(frame).not.toContain("…");
  expect(frame).toContain("ChangesFile");
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

  setup.mockInput.pressKey("RETURN");
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

test("the visible tree removes deleted files without remounting", async () => {
  let files = ["README.md", "gone.ts"];
  const setup = await testRender(
    <ProjectTreeView loadFiles={async () => files} onSelectFile={() => {}} theme={DARK} />,
    { width: 40, height: 12 },
  );

  await waitForText(setup, "gone.ts");
  files = ["README.md"];
  await waitForTextGone(setup, "gone.ts");
  expect(setup.captureCharFrame()).toContain("README.md");
  setup.renderer.destroy();
});

test("refresh keeps the selected file when an earlier file disappears", async () => {
  let files = ["a.ts", "b.ts", "c.ts"];
  const opened: string[] = [];
  const setup = await testRender(
    <ProjectTreeView
      loadFiles={async () => files}
      onSelectFile={(path) => opened.push(path)}
      focused
      theme={DARK}
    />,
    { width: 40, height: 12 },
  );

  await waitForText(setup, "b.ts");
  setup.mockInput.pressKey("j");
  await settle(setup);
  files = ["b.ts", "c.ts"];
  await waitForTextGone(setup, "a.ts");
  setup.mockInput.pressKey("RETURN");
  await settle(setup);

  expect(opened).toEqual(["b.ts"]);
  setup.renderer.destroy();
});

test("a double-click requests a persistent file tab", async () => {
  const opened: { path: string; persistent: boolean }[] = [];
  const setup = await testRender(
    <ProjectTreeView
      loadFiles={async () => ["README.md"]}
      onSelectFile={(path, persistent) => opened.push({ path, persistent: persistent === true })}
      theme={DARK}
    />,
    { width: 40, height: 12 },
  );

  await waitForText(setup, "README.md");
  const file = locateText(setup, "README.md");
  await setup.mockMouse.doubleClick(file.column, file.row);
  expect(opened).toEqual([
    { path: "README.md", persistent: false },
    { path: "README.md", persistent: false },
    { path: "README.md", persistent: true },
  ]);
  setup.renderer.destroy();
});
