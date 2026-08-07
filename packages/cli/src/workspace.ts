/** Workspace key resolution (#9): repo root + branch from the cwd. */

import type { WorkspaceKey } from "@cueloop/schema";

async function git(args: string[], cwd: string): Promise<string | null> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return null;
  return out.trim();
}

export async function resolveWorkspace(cwd = process.cwd()): Promise<WorkspaceKey> {
  const repoRoot = (await git(["rev-parse", "--show-toplevel"], cwd)) ?? cwd;
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)) ?? "detached";
  return { repoRoot, branch };
}

export async function workingTreeDiff(cwd = process.cwd()): Promise<string> {
  const tracked = (await git(["diff", "HEAD"], cwd)) ?? "";
  // untracked files included by default (map note: changed-first)
  const untrackedList = (await git(["ls-files", "--others", "--exclude-standard"], cwd)) ?? "";
  let untracked = "";
  for (const file of untrackedList.split("\n").filter(Boolean)) {
    const diff = await git(["diff", "--no-index", "--", "/dev/null", file], cwd);
    if (diff) untracked += diff + "\n";
  }
  return [tracked, untracked].filter(Boolean).join("\n");
}
