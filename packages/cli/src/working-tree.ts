/** Working-tree diff capture for `cueloop diff`, untracked files included. */

async function git(args: string[], cwd: string): Promise<string | null> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return null;
  return out.trim();
}

export async function workingTreeDiff(cwd = process.cwd()): Promise<string> {
  const tracked = (await git(["diff", "HEAD"], cwd)) ?? "";
  // untracked files included by default
  const untrackedList = (await git(["ls-files", "--others", "--exclude-standard"], cwd)) ?? "";
  let untracked = "";
  for (const file of untrackedList.split("\n").filter(Boolean)) {
    // `git diff --no-index` exits 1 when the files differ - that is success here
    const proc = Bun.spawn(["git", "diff", "--no-index", "--", "/dev/null", file], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if ((code === 0 || code === 1) && out.trim()) untracked += out.trim() + "\n";
  }
  return [tracked, untracked].filter(Boolean).join("\n");
}
