import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VcsSourceManager } from "./vcs-source";
import { workingTreeDiff } from "./working-tree";

const created: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "cueloop-vcs-"));

  created.push(path);

  return path;
}

function command(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });

  if (result.exitCode !== 0)
    throw new Error(`${args.join(" ")} failed: ${result.stderr.toString()}`);
}

function gitRepo(): string {
  const repo = temporaryDirectory();

  command(repo, "git", "init", "-q", "-b", "main");
  command(repo, "git", "config", "user.name", "Test");
  command(repo, "git", "config", "user.email", "test@example.com");
  writeFileSync(join(repo, "a.txt"), "before\n");
  command(repo, "git", "add", ".");
  command(repo, "git", "commit", "-qm", "initial");

  return repo;
}

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("VcsSourceManager", () => {
  test("a directory without a VCS keeps the empty Git workbench behavior", async () => {
    const plain = temporaryDirectory();
    const config = join(temporaryDirectory(), "config.toml");
    const source = new VcsSourceManager(config);

    expect((await source.select(plain)).adapter.id).toBe("git");
    expect(await source.capture(plain)).toMatchObject({ patch: "", files: [] });
  });

  test("Git auto capture preserves the existing patch and curatable files", async () => {
    const repo = gitRepo();
    const config = join(temporaryDirectory(), "config.toml");

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
    const repo = gitRepo();
    const config = join(temporaryDirectory(), "config.toml");

    command(repo, "jj", "git", "init", "--colocate", repo);
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
    const repo = gitRepo();
    const config = join(temporaryDirectory(), "config.toml");

    command(repo, "jj", "git", "init", "--colocate", repo);
    mkdirSync(join(repo, ".cueloop"));
    writeFileSync(join(repo, ".cueloop", "config.toml"), '[vcs]\nprovider = "git"\n');
    const source = new VcsSourceManager(config);

    expect((await source.select(repo)).adapter.id).toBe("git");
    expect((await source.select(repo, "jj")).adapter.id).toBe("jj");
  });

  test("a personal extension can register a custom adapter", async () => {
    const root = temporaryDirectory();
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
