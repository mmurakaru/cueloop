/** Workspace resolution for hooks: repo root + branch from the event cwd. */

import type { WorkspaceKey } from "@cueloop/schema";

async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    return out.trim();
  } catch {
    return null;
  }
}

export async function resolveWorkspaceForHook(cwd: string): Promise<WorkspaceKey> {
  const repoRoot = (await git(["rev-parse", "--show-toplevel"], cwd)) ?? cwd;
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)) ?? "detached";
  return { repoRoot, branch };
}
