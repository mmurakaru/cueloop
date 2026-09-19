/** The git repo fixture yields, through the product's own diff, a patch and per-file contents with git's status. */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTestGitRepo, type TestGitRepo } from "./git-repo";

let repo: TestGitRepo | null = null;

afterEach(() => {
  repo?.cleanup();
  repo = null;
});

describe("createTestGitRepo", () => {
  test("commits the before state and leaves the after state in the working tree", async () => {
    // Given a modified, an added, and a deleted file
    repo = createTestGitRepo([
      { path: "src/store.ts", before: "const items = [];\n", after: "const items = new Map();\n" },
      { path: "src/new.ts", before: null, after: "export const fresh = true;\n" },
      { path: "src/old.ts", before: "export const stale = true;\n", after: null },
    ]);

    // When the working tree is diffed the way the CLI does it
    const { patch, files } = await repo.diff();

    // Then the patch carries every change and git classifies each file
    expect(patch).toContain("-const items = [];");
    expect(patch).toContain("+const items = new Map();");
    expect(patch).toContain("+export const fresh = true;");
    expect(patch).toContain("-export const stale = true;");
    expect(files.map((file) => [file.path, file.status]).toSorted()).toEqual([
      ["src/new.ts", "added"],
      ["src/old.ts", "deleted"],
      ["src/store.ts", "modified"],
    ]);
    expect(existsSync(join(repo.dir, "src/old.ts"))).toBe(false);
  });

  test("cleanup removes the temp directory", () => {
    // Given a repo
    const created = createTestGitRepo([{ path: "a.txt", before: "a\n", after: "b\n" }]);

    // When cleaned up
    created.cleanup();

    // Then the directory is gone
    expect(existsSync(created.dir)).toBe(false);
  });
});
