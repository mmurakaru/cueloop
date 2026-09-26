import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTestVcsDirectory(created: string[]): string {
  const path = mkdtempSync(join(tmpdir(), "cueloop-vcs-"));

  created.push(path);

  return path;
}

export function runTestVcsCommand(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });

  if (result.exitCode !== 0)
    throw new Error(`${args.join(" ")} failed: ${result.stderr.toString()}`);
}

export function createTestVcsGitRepo(created: string[]): string {
  const repo = createTestVcsDirectory(created);

  runTestVcsCommand(repo, "git", "init", "-q", "-b", "main");
  runTestVcsCommand(repo, "git", "config", "user.name", "Test");
  runTestVcsCommand(repo, "git", "config", "user.email", "test@example.com");
  writeFileSync(join(repo, "a.txt"), "before\n");
  runTestVcsCommand(repo, "git", "add", ".");
  runTestVcsCommand(repo, "git", "commit", "-qm", "initial");

  return repo;
}
