/** Working-tree diff capture for `cueloop diff`, untracked files included. */

import { join } from "node:path";
import type { DiffFileContents } from "@cueloop/schema";

async function git(args: string[], cwd: string): Promise<string | null> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return null;
  return out.trim();
}

/** The blob at HEAD for a path, or "" when the path is not in HEAD (new file). */
async function headContents(path: string, cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "show", `HEAD:${path}`], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  const out = await new Response(proc.stdout).text();
  return (await proc.exited) === 0 ? out : "";
}

/** The working-tree file, or "" when it is gone (deleted). */
async function workingContents(path: string, cwd: string): Promise<string> {
  try {
    return await Bun.file(join(cwd, path)).text();
  } catch {
    return "";
  }
}

/**
 * Full old/new contents for every tracked change against HEAD. The NUL-delimited
 * name-status stream carries a status letter per entry (two paths for a
 * rename/copy), so full file pairs survive paths with spaces or unicode.
 */
async function trackedFileContents(cwd: string): Promise<DiffFileContents[]> {
  const nameStatus = (await git(["diff", "HEAD", "--name-status", "-z"], cwd)) ?? "";
  const tokens = nameStatus.split("\0").filter((token) => token.length > 0);
  const files: DiffFileContents[] = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    const status = tokens[cursor++]!;
    const code = status[0];
    if (code === "R" || code === "C") {
      const oldPath = tokens[cursor++]!;
      const newPath = tokens[cursor++]!;
      files.push({
        path: newPath,
        oldContents: await headContents(oldPath, cwd),
        newContents: await workingContents(newPath, cwd),
      });
    } else {
      const path = tokens[cursor++]!;
      files.push({
        path,
        oldContents: code === "A" ? "" : await headContents(path, cwd),
        newContents: code === "D" ? "" : await workingContents(path, cwd),
      });
    }
  }
  return files;
}

export interface WorkingTreeDiff {
  patch: string;
  /** Full file contents per changed file, so hunk curation stays exactly applyable. */
  files: DiffFileContents[];
}

export async function workingTreeDiff(cwd = process.cwd()): Promise<WorkingTreeDiff> {
  const tracked = (await git(["diff", "HEAD"], cwd)) ?? "";
  const files = await trackedFileContents(cwd);
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
    if ((code === 0 || code === 1) && out.trim()) {
      untracked += out.trim() + "\n";
      files.push({ path: file, oldContents: "", newContents: await workingContents(file, cwd) });
    }
  }
  return { patch: [tracked, untracked].filter(Boolean).join("\n"), files };
}
