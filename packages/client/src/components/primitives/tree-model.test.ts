import { describe, expect, test } from "bun:test";
import { allFolderIds, flattenTree, statusMeta, type TreeNode } from "./tree-model";

const TREE: TreeNode[] = [
  {
    id: "src",
    label: "src",
    children: [
      { id: "src/a.ts", label: "a.ts", status: "modified" },
      {
        id: "src/nested",
        label: "nested",
        children: [
          {
            id: "src/nested/only",
            label: "only",
            children: [{ id: "deep", label: "deep.ts", status: "added" }],
          },
        ],
      },
    ],
  },
  { id: "readme", label: "README.md" },
];

describe("flattenTree", () => {
  test("a collapsed folder shows only itself; expanding it reveals its children", () => {
    // Act
    const collapsed = flattenTree(TREE, { expandedIds: new Set() });
    const rows = flattenTree(TREE, { expandedIds: new Set(["src"]) });

    // Assert
    expect(collapsed.map((row) => row.label)).toEqual(["src", "README.md"]);
    expect(rows.map((row) => [row.label, row.depth, row.isFolder])).toEqual([
      ["src", 0, true],
      ["a.ts", 1, false],
      ["nested", 1, true],
      ["README.md", 0, false],
    ]);
    expect(rows.find((row) => row.label === "src")!.expanded).toBe(true);
    expect(rows.find((row) => row.label === "a.ts")!.status).toBe("modified");
  });

  test("flattenEmptyDirectories collapses a single-subfolder chain into one row", () => {
    // Act - src open but the chain itself collapsed (none of its ids expanded)
    const collapsed = flattenTree(TREE, {
      expandedIds: new Set(["src"]),
      flattenEmptyDirectories: true,
    });
    // Act - expanding via any id along the chain opens it
    const expanded = flattenTree(TREE, {
      expandedIds: new Set(["src", "src/nested/only"]),
      flattenEmptyDirectories: true,
    });

    // Assert
    expect(collapsed.map((row) => row.label)).toEqual(["src", "a.ts", "nested/only", "README.md"]);
    expect(expanded.map((row) => row.label)).toEqual([
      "src",
      "a.ts",
      "nested/only",
      "deep.ts",
      "README.md",
    ]);
  });

  test("without the flag the chain stays one folder per row", () => {
    // Act
    const rows = flattenTree(TREE, {
      expandedIds: new Set(["src", "src/nested", "src/nested/only"]),
    });

    // Assert
    expect(rows.map((row) => [row.label, row.depth])).toEqual([
      ["src", 0],
      ["a.ts", 1],
      ["nested", 1],
      ["only", 2],
      ["deep.ts", 3],
      ["README.md", 0],
    ]);
  });
});

describe("allFolderIds", () => {
  test("collects every folder, not the leaves", () => {
    // Assert
    expect([...allFolderIds(TREE)].sort()).toEqual(["src", "src/nested", "src/nested/only"]);
  });
});

describe("statusMeta", () => {
  test("maps each status to a letter and a tone", () => {
    // Assert
    expect(statusMeta("added")).toEqual({ letter: "A", tone: "green" });
    expect(statusMeta("deleted")).toEqual({ letter: "D", tone: "red" });
    expect(statusMeta("ignored")).toEqual({ letter: "I", tone: "muted" });
  });
});
