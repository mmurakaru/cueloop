/**
 * A test git repo: one commit holding every "before", a working tree holding
 * every "after". `diff()` runs the product's own working-tree diff, so a test
 * reviews exactly the patch the CLI would capture. Hermetic against the
 * developer's git config; removed by `cleanup`.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Remove a fixture tree and prove it is gone. Falls back to the shell `rm`
 * when the runtime's recursive remove leaves entries behind, and names the
 * survivors when even that fails, so a leaked fixture explains itself in CI.
 */
function removeDirectoryTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  if (!existsSync(dir)) return;
  Bun.spawnSync(["rm", "-rf", dir], { stdout: "ignore", stderr: "ignore" });
  if (!existsSync(dir)) return;
  const survivors = readdirSync(dir, { recursive: true }).slice(0, 20).join(", ");

  throw new Error(`Test git repo cleanup left entries behind in ${dir}: ${survivors}`);
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
  // no detached auto-gc or maintenance may outlive the fixture and rewrite .git after cleanup
  runGit(["config", "gc.auto", "0"], dir);
  runGit(["config", "maintenance.auto", "false"], dir);
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
      removeDirectoryTree(dir);
    },
  };
}
