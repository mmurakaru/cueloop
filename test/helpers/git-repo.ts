/**
 * A test git repo: one commit holding every "before", a working tree holding
 * every "after". `diff()` runs the product's own working-tree diff, so a test
 * reviews exactly the patch the CLI would capture. Hermetic against the
 * developer's git config; removed by `cleanup`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { workingTreeDiff, type WorkingTreeDiff } from "@cueloop/daemon/working-tree";

/** One file of the fixture: committed `before`, working-tree `after` (null means absent). */
export interface TestChangedFile {
  path: string;
  before: string | null;
  after: string | null;
}

export interface TestGitRepo {
  dir: string;
  /** The working tree against HEAD, untracked files included, as the CLI captures it. */
  diff(): Promise<WorkingTreeDiff>;
  cleanup(): void;
}

function runGit(args: string[], cwd: string): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "cueloop test",
      GIT_AUTHOR_EMAIL: "test@cueloop.dev",
      GIT_COMMITTER_NAME: "cueloop test",
      GIT_COMMITTER_EMAIL: "test@cueloop.dev",
    },
    stdout: "ignore",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Test git repo command failed: git ${args.join(" ")}\n${result.stderr.toString()}`,
    );
  }
}

function writeFixtureFile(dir: string, path: string, contents: string): void {
  const target = join(dir, path);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

/**
 * Build a repo whose HEAD holds every `before` and whose working tree holds
 * every `after`. Files with `before: null` are added, `after: null` deleted.
 */
export function createTestGitRepo(changedFiles: TestChangedFile[]): TestGitRepo {
  const dir = mkdtempSync(join(tmpdir(), "cueloop-git-repo-"));

  runGit(["init", "--quiet", "--initial-branch=main"], dir);
  runGit(["config", "commit.gpgsign", "false"], dir);
  for (const file of changedFiles) {
    if (file.before !== null) writeFixtureFile(dir, file.path, file.before);
  }
  runGit(["add", "--all"], dir);
  runGit(["commit", "--quiet", "--allow-empty", "-m", "initial"], dir);
  for (const file of changedFiles) {
    if (file.after === null) rmSync(join(dir, file.path), { force: true });
    else writeFixtureFile(dir, file.path, file.after);
  }

  return {
    dir,
    diff() {
      return workingTreeDiff(dir);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
