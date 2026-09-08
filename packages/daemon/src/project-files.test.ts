/** Read-only repo introspection: the tracked file tree and safe, bounded file reads. */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjectFiles, readProjectFile } from "./project-files";

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });

  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}`);
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "cueloop-project-files-"));
  git(["init", "-q", "-b", "main"], repo);
  git(["config", "user.email", "t@t"], repo);
  git(["config", "user.name", "t"], repo);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("listProjectFiles", () => {
  test("returns the tracked files sorted ascending", async () => {
    // Given a repo whose files are committed out of alphabetical order
    writeFileSync(join(repo, "z.ts"), "export const z = 1;\n");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(repo, "m.ts"), "export const m = 1;\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);

    // When the tracked files are listed
    const files = await listProjectFiles(repo);

    // Then every tracked path comes back in ascending order
    expect(files).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  test("returns [] for a directory that is not a git repo", async () => {
    // Given a plain directory with a file but no git repo
    const plain = mkdtempSync(join(tmpdir(), "cueloop-project-files-plain-"));

    writeFileSync(join(plain, "a.ts"), "export const a = 1;\n");
    try {
      // When the tracked files are listed
      const files = await listProjectFiles(plain);

      // Then nothing comes back and no error is thrown
      expect(files).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  test("returns [] when there is no repoRoot", async () => {
    expect(await listProjectFiles(undefined)).toEqual([]);
  });
});

describe("readProjectFile", () => {
  test("reads a repo-relative file as UTF-8", async () => {
    // Given a committed file with known contents
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);

    // When it is read by its repo-relative path
    const contents = await readProjectFile(repo, "a.ts");

    // Then its exact bytes come back
    expect(contents).toBe("export const a = 1;\n");
  });

  test("returns null for a path that escapes the repo via ../", async () => {
    // Given a secret file just outside the repo root
    const secret = join(repo, "..", "outside-secret.txt");

    writeFileSync(secret, "top secret\n");
    try {
      // When a traversal path tries to reach it
      const contents = await readProjectFile(repo, "../outside-secret.txt");

      // Then the read is refused
      expect(contents).toBeNull();
    } finally {
      rmSync(secret, { force: true });
    }
  });

  test("returns null for a missing file", async () => {
    expect(await readProjectFile(repo, "nope.ts")).toBeNull();
  });

  test("returns null for a directory (not a regular file)", async () => {
    // Given a directory inside the repo
    mkdirSync(join(repo, "src"));

    // When the directory path is read
    const contents = await readProjectFile(repo, "src");

    // Then it is refused
    expect(contents).toBeNull();
  });

  test("returns null for a file larger than the cap", async () => {
    // Given a file just over one megabyte
    writeFileSync(join(repo, "big.bin"), "x".repeat(1024 * 1024 + 1));

    // When it is read
    const contents = await readProjectFile(repo, "big.bin");

    // Then it is refused for exceeding the size cap
    expect(contents).toBeNull();
  });

  test("returns null when there is no repoRoot", async () => {
    expect(await readProjectFile(undefined, "a.ts")).toBeNull();
  });
});
