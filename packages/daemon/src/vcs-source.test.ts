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

  test("an installed package loads its daemon adapter entry", async () => {
    const root = createTestVcsDirectory(created);
    const repo = join(root, "repo");
    const installRoot = join(root, "extensions");
    const packageRoot = join(installRoot, "node_modules", "example-vcs");

    mkdirSync(repo);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(installRoot, "package.json"),
      JSON.stringify({ dependencies: { "example-vcs": "1.0.0" } }),
    );
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ cueloop: { daemon: "./daemon.ts" } }),
    );
    writeFileSync(
      join(packageRoot, "daemon.ts"),
      `export default (api) => api.registerVcsAdapter({
      apiVersion: 1,
      id: "example.installed",
      detect: async (cwd) => cwd,
      captureWorkingDiff: async () => ({ patch: "installed patch", files: [] }),
      listChanges: async () => [],
      listFiles: async () => [],
    });`,
    );
    writeFileSync(join(root, "config.toml"), '[vcs]\nprovider = "example.installed"\n');
    const source = new VcsSourceManager(join(root, "config.toml"), installRoot);

    expect((await source.select(repo)).adapter.id).toBe("example.installed");
    expect((await source.capture(repo)).patch).toBe("installed patch");
  });

  test("a failing extension detection leaves the built-in Git source usable", async () => {
    const root = createTestVcsDirectory(created);
    const repo = createTestVcsGitRepo(created);
    const extension = join(root, "broken.ts");
    const config = join(root, "config.toml");

    writeFileSync(
      extension,
      `export default (api) => api.registerVcsAdapter({
        apiVersion: 1,
        id: "example.broken",
        detect: async () => { throw new Error("broken checkout probe"); },
        captureWorkingDiff: async () => ({ patch: "", files: [] }),
        listChanges: async () => [],
        listFiles: async () => [],
      });\n`,
    );
    writeFileSync(config, `[vcs]\nextensions = ["${extension}"]\n`);
    const source = new VcsSourceManager(config);

    expect((await source.select(repo)).adapter.id).toBe("git");
    expect((await source.capture(repo)).vcs).toBe("git");
    expect(source.extensionErrors).toContain(
      "VCS adapter example.broken detection failed: Error: broken checkout probe",
    );
  });
});
