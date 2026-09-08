import { describe, expect, test } from "bun:test";
import { buildStoryTree, type LoadedStory } from "./story";
import type { TreeNode } from "./primitives/tree-model";

/** A story object whose render is never invoked in these structural tests. */
const STUB = { render: () => null };

function story(moduleTitle: string, storyName: string): LoadedStory {
  return { moduleTitle, storyName, story: STUB };
}

function childLabels(node: TreeNode): string[] {
  return (node.children ?? []).map((child) => child.label);
}

describe("buildStoryTree", () => {
  test("splits moduleTitle on / into nested folders keyed by their path", () => {
    // Arrange
    const stories = [story("Primitives/Tree", "Default"), story("Layout/AppShell", "Default")];

    // Act
    const tree = buildStoryTree(stories);

    // Assert
    expect(tree.map((node) => [node.id, node.label])).toEqual([
      ["Primitives", "Primitives"],
      ["Layout", "Layout"],
    ]);
    expect(tree[0]!.children!.map((node) => node.id)).toEqual(["Primitives/Tree"]);
  });

  test("groups sibling components under one shared parent folder", () => {
    // Arrange
    const stories = [story("Primitives/Tree", "Default"), story("Primitives/Card", "Default")];

    // Act
    const tree = buildStoryTree(stories);

    // Assert
    expect(tree).toHaveLength(1);
    expect(childLabels(tree[0]!)).toEqual(["Tree", "Card"]);
  });

  test("nests to the full depth of the moduleTitle path", () => {
    // Arrange
    const stories = [story("A/B/C", "Only")];

    // Act
    const tree = buildStoryTree(stories);
    const a = tree[0]!;
    const b = a.children![0]!;

    // Assert
    expect([a.id, b.id]).toEqual(["A", "A/B"]);
    expect(b.children![0]!.id).toBe("A/B/C");
  });

  test("adds each story as a leaf keyed `${moduleTitle}/${storyName}` under its component", () => {
    // Arrange
    const stories = [story("Primitives/Tree", "Empty"), story("Primitives/Tree", "Deep")];

    // Act
    const tree = buildStoryTree(stories);
    const component = tree[0]!.children![0]!;

    // Assert
    expect(component.id).toBe("Primitives/Tree");
    expect(component.children!.map((leaf) => [leaf.id, leaf.label])).toEqual([
      ["Primitives/Tree/Empty", "Empty"],
      ["Primitives/Tree/Deep", "Deep"],
    ]);
  });

  test("hoists a component with a single story of its own name into one leaf row", () => {
    // Arrange
    const stories = [story("Primitives/Card", "Card")];

    // Act
    const tree = buildStoryTree(stories);
    const hoisted = tree[0]!.children![0]!;

    // Assert
    expect(hoisted.children).toBeUndefined();
    expect(hoisted.id).toBe("Primitives/Card/Card");
    expect(hoisted.label).toBe("Card");
  });

  test("keeps the folder when its single story differs from the component name", () => {
    // Arrange
    const stories = [story("Primitives/Card", "Default")];

    // Act
    const tree = buildStoryTree(stories);
    const component = tree[0]!.children![0]!;

    // Assert
    expect(component.id).toBe("Primitives/Card");
    expect(component.children!.map((leaf) => leaf.id)).toEqual(["Primitives/Card/Default"]);
  });
});
