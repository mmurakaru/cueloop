import { expect, test } from "bun:test";
import React from "react";
import { testRender } from "@opentui/react/test-utils";
import type { Renderable } from "@opentui/core";
import { allowEventLoopUpdates } from "../test-support";
import { EditorGrid } from "./EditorGrid";
import { makeGroup, splitGroup, welcomeTab, type EditorNode } from "./editor-grid";
import { WelcomePlayground } from "./WelcomePlayground";

function findById(node: Renderable, id: string): Renderable | undefined {
  if (node.id === id) return node;

  for (const child of node.getChildren()) {
    const found = findById(child, id);

    if (found) return found;
  }

  return undefined;
}

function groupIds(node: EditorNode): string[] {
  if (node.type === "group") return [node.id];

  return node.children.flatMap(groupIds);
}

test("mixed splits keep each Welcome page inside its own tile", async () => {
  const first = makeGroup([welcomeTab()]);
  let tree: EditorNode = first;
  let focusGroupId = first.id;

  for (const direction of ["right", "up", "left", "down"] as const) {
    const next = splitGroup(tree, focusGroupId, direction);

    tree = next.tree;
    focusGroupId = next.focusGroupId;
  }

  const setup = await testRender(
    <EditorGrid
      tree={tree}
      focusedGroupId={focusGroupId}
      onFocusGroup={() => {}}
      onActivateTab={() => {}}
      onCloseTab={() => {}}
      onSplit={() => {}}
      onZoom={() => {}}
      zoomed={false}
      renderTab={(_, focused) => <WelcomePlayground quickActions={[]} suspended={!focused} />}
    />,
    { width: 120, height: 48 },
  );

  allowEventLoopUpdates();
  await setup.waitForVisualIdle();
  expect(setup.renderer.listenerCount("frame")).toBeLessThan(10);
  expect(setup.renderer.listenerCount("resize")).toBeLessThan(10);
  expect(setup.renderer.keyInput.listenerCount("keypress")).toBeLessThan(10);

  for (const id of groupIds(tree)) {
    const group = findById(setup.renderer.root, `editor-group:${id}`);
    const scroll = group && findById(group, "diff-scroll");

    expect(group).toBeDefined();
    expect(scroll).toBeDefined();
    expect(scroll!.y).toBeGreaterThanOrEqual(group!.y + 2);
    expect(scroll!.y + scroll!.height).toBeLessThanOrEqual(group!.y + group!.height);
  }

  setup.renderer.destroy();
});

test("Split is disabled at eight tiles and when a tile is too small", async () => {
  const first = makeGroup([welcomeTab()]);
  let tree: EditorNode = first;
  let focusGroupId = first.id;

  for (const direction of ["right", "up", "left", "down", "right", "up", "left"] as const) {
    const next = splitGroup(tree, focusGroupId, direction);

    tree = next.tree;
    focusGroupId = next.focusGroupId;
  }

  for (const [candidate, width, height] of [
    [tree, 240, 100],
    [first, 40, 12],
  ] as const) {
    let splitCalls = 0;
    const setup = await testRender(
      <EditorGrid
        tree={candidate}
        focusedGroupId={first.id}
        onFocusGroup={() => {}}
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onSplit={() => {
          splitCalls += 1;
        }}
        onZoom={() => {}}
        zoomed={false}
        renderTab={() => <text>body</text>}
      />,
      { width, height },
    );

    allowEventLoopUpdates();
    await setup.waitForVisualIdle();
    const button = findById(setup.renderer.root, `split-button:${first.id}`);

    expect(button).toBeDefined();
    await setup.mockMouse.click(button!.x, button!.y);
    expect(setup.captureCharFrame()).not.toContain("right →");
    expect(splitCalls).toBe(0);
    setup.renderer.destroy();
  }
});
