import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestVcsDirectory,
  createTestVcsGitRepo,
  runTestVcsCommand,
} from "../../../test/helpers/vcs-repo";
import { VcsSourceManager } from "./vcs-source";
import { workingTreeDiff } from "./working-tree";

const created: string[] = [];

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("VcsSourceManager", () => {
  test("a directory without a VCS keeps the empty Git workbench behavior", async () => {
    const plain = createTestVcsDirectory(created);
    const config = join(createTestVcsDirectory(created), "config.toml");
    const source = new VcsSourceManager(config);

    expect((await source.select(plain)).adapter.id).toBe("git");
    expect(await source.capture(plain)).toMatchObject({ patch: "", files: [] });
  });

  test("Git auto capture preserves the existing patch and curatable files", async () => {
    const repo = createTestVcsGitRepo(created);
    const config = join(createTestVcsDirectory(created), "config.toml");

    writeFileSync(join(repo, "a.txt"), "after\n");
    writeFileSync(join(repo, "new.txt"), "new\n");
    writeFileSync(join(repo, "space name.txt"), "space\n");
    const baseline = await workingTreeDiff(repo);
    const source = new VcsSourceManager(config);
    const selected = await source.select(repo);
    const captured = await source.capture(repo);

    expect(selected.adapter.id).toBe("git");
    expect({ patch: captured.patch, files: captured.files }).toEqual(baseline);
  });

  test("JJ wins a colocated checkout and captures its native working-copy revision", async () => {
    const repo = createTestVcsGitRepo(created);
    const config = join(createTestVcsDirectory(created), "config.toml");

    runTestVcsCommand(repo, "jj", "git", "init", "--colocate", repo);
    writeFileSync(join(repo, "a.txt"), "after\n");
    writeFileSync(join(repo, "new.txt"), "new\n");
    writeFileSync(join(repo, "space name.txt"), "space\n");
    const source = new VcsSourceManager(config);
    const selected = await source.select(repo);
    const captured = await source.capture(repo);

    expect(selected.adapter.id).toBe("jj");
    expect(captured.patch).toContain("+after");
    expect(captured.patch).toContain("+new");
    expect(captured.files).toContainEqual({
      path: "a.txt",
      oldContents: "before\n",
      newContents: "after\n",
      status: "modified",
    });
    expect(captured.files).toContainEqual({
      path: "new.txt",
      oldContents: "",
      newContents: "new\n",
      status: "added",
    });
    expect(captured.files).toContainEqual({
      path: "space name.txt",
      oldContents: "",
      newContents: "space\n",
      status: "added",
    });
    expect(await selected.adapter.listFiles(repo)).toContain("space name.txt");
    expect(captured.source?.changeId).toBeTruthy();
    expect(captured.source?.revisionId).toMatch(/^[0-9a-f]{40}$/);
  });

  test("repo config can select Git in a colocated checkout", async () => {
    const repo = createTestVcsGitRepo(created);
    const config = join(createTestVcsDirectory(created), "config.toml");

    runTestVcsCommand(repo, "jj", "git", "init", "--colocate", repo);
    mkdirSync(join(repo, ".cueloop"));
    writeFileSync(join(repo, ".cueloop", "config.toml"), '[vcs]\nprovider = "git"\n');
    const source = new VcsSourceManager(config);

    expect((await source.select(repo)).adapter.id).toBe("git");
    expect((await source.select(repo, "jj")).adapter.id).toBe("jj");
  });

  test("a personal extension can register a custom adapter", async () => {
    const root = createTestVcsDirectory(created);
    const repo = join(root, "repo");
    const extension = join(root, "adapter.ts");
    const config = join(root, "config.toml");

    mkdirSync(repo);
    writeFileSync(
      extension,
      `export default (api) => api.registerVcsAdapter({
      apiVersion: 1,
      id: "example.sapling",
      detect: async (cwd) => cwd,
      captureWorkingDiff: async () => ({ patch: "custom patch", files: [] }),
      listChanges: async () => [],
      listFiles: async () => ["readme.md"],
    });\n`,
    );
    writeFileSync(config, `[vcs]\nprovider = "example.sapling"\nextensions = ["${extension}"]\n`);
    const source = new VcsSourceManager(config);

    expect((await source.select(repo)).adapter.id).toBe("example.sapling");
    expect((await source.capture(repo)).patch).toBe("custom patch");
  });
});
