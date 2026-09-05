import { describe, expect, test } from "bun:test";
import type { DiffFileContents } from "@cueloop/schema";
import { buildFileTree } from "./file-tree";

function file(path: string, status: DiffFileContents["status"] = "modified"): DiffFileContents {
  return { path, oldContents: "a", newContents: "b", status };
}

describe("buildFileTree", () => {
  test("nests files under their directories and keeps the full path as the leaf id", () => {
    // Arrange
    const files = [file("src/app/main.ts"), file("src/app/util.ts"), file("README.md")];

    // Act
    const tree = buildFileTree(files);

    // Assert - one src folder over one app folder over two leaves, plus a root file
    expect(tree.map((node) => node.label)).toEqual(["src", "README.md"]);
    const app = tree[0]!.children![0]!;

    expect(app.label).toBe("app");
    expect(app.children!.map((leaf) => leaf.id)).toEqual(["src/app/main.ts", "src/app/util.ts"]);
  });

  test("carries the git status onto each leaf so the tree can tint it", () => {
    // Act
    const tree = buildFileTree([file("a.ts", "added"), file("b.ts", "deleted")]);

    // Assert
    expect(tree.map((leaf) => leaf.status)).toEqual(["added", "deleted"]);
  });

  test("merges files that share a directory into one folder node", () => {
    // Act
    const tree = buildFileTree([file("pkg/one.ts"), file("pkg/two.ts")]);

    // Assert
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(2);
  });

  test("returns an empty tree for no changes", () => {
    expect(buildFileTree([])).toEqual([]);
  });
});
