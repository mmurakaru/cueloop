/** Working-tree diff capture for `cueloop diff`, untracked files included. */

import { join } from "node:path";
import type { DiffFileContents, DiffFileStatus } from "@cueloop/schema";

async function git(args: string[], cwd: string): Promise<string | null> {
  const gitProcess = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(gitProcess.stdout).text();

  if ((await gitProcess.exited) !== 0) return null;

  return stdout.trim();
}

/** Map a `git diff --name-status` letter to a diff status; renames/copies read as modified. */
function statusFromCode(code: string): DiffFileStatus {
  const letter = code.charAt(0);
  if (letter === "D") return "deleted";
  if (letter === "A") return "added";

  return "modified";
}

/**
 * The working tree's changed files as repo-relative path plus status - a fast listing for the changes
 * navigator that never reads file contents (unlike workingTreeDiff, which captures full curation copies).
 * Uses tab-separated name-status so a trimmed leading column can never shift the parse.
 */
export async function workingChangeList(
  cwd = process.cwd(),
): Promise<{ path: string; status: DiffFileStatus }[]> {
  const changes: { path: string; status: DiffFileStatus }[] = [];
  const tracked = (await git(["diff", "--name-status", "HEAD"], cwd)) ?? "";

  for (const line of tracked.split("\n")) {
    if (line.trim().length === 0) continue;
    const parts = line.split("\t");
    // a rename is "R100<tab>old<tab>new"; the new path (last field) is what the reviewer opens
    changes.push({ path: parts[parts.length - 1]!, status: statusFromCode(parts[0]!) });
  }

  const untracked = (await git(["ls-files", "--others", "--exclude-standard"], cwd)) ?? "";

  for (const path of untracked.split("\n")) {
    if (path.trim().length > 0) changes.push({ path, status: "added" });
  }

  return changes;
}

/** The blob at HEAD for a path, or "" when the path is not in HEAD (new file). */
async function headContents(path: string, cwd: string): Promise<string> {
  const gitProcess = Bun.spawn(["git", "show", `HEAD:${path}`], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(gitProcess.stdout).text();

  return (await gitProcess.exited) === 0 ? stdout : "";
}

/** The working-tree file, or "" when it is gone (deleted). */
async function workingContents(path: string, cwd: string): Promise<string> {
  try {
    return await Bun.file(join(cwd, path)).text();
  } catch {
    return "";
  }
}

/** A NUL byte marks content git would treat as binary - not text-curatable. */
function looksBinary(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 0) return true;
  }

  return false;
}

/**
 * Full old/new contents for every tracked change against HEAD, classified by
 * git's own status letter. Renames/copies and binary files are omitted: a
 * path+text pair cannot express a rename header or a binary blob, so curation
 * would emit a patch that drops the old path or corrupts the file - leaving them
 * out keeps those changes in the patch but simply not curatable. The
 * NUL-delimited stream survives paths with spaces or unicode.
 */
async function trackedFileContents(cwd: string): Promise<DiffFileContents[]> {
  const nameStatus = (await git(["diff", "HEAD", "--name-status", "-z"], cwd)) ?? "";
  const tokens = nameStatus.split("\0").filter((token) => token.length > 0);
  const files: DiffFileContents[] = [];
  let cursor = 0;

  while (cursor < tokens.length) {
    const code = tokens[cursor++]![0];

    if (code === "R" || code === "C") {
      cursor += 2;
      continue;
    }
    const path = tokens[cursor++]!;
    const oldContents = code === "A" ? "" : await headContents(path, cwd);
    const newContents = code === "D" ? "" : await workingContents(path, cwd);

    if (looksBinary(oldContents) || looksBinary(newContents)) continue;
    const status = code === "A" ? "added" : code === "D" ? "deleted" : "modified";

    files.push({ path, oldContents, newContents, status });
  }

  return files;
}

export interface WorkingTreeDiff {
  patch: string;
  /** Full file contents per curatable changed file, keeping curation applyable. */
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
    const gitProcess = Bun.spawn(["git", "diff", "--no-index", "--", "/dev/null", file], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const stdout = await new Response(gitProcess.stdout).text();
    const code = await gitProcess.exited;

    if ((code === 0 || code === 1) && stdout.trim()) {
      untracked += stdout.trim() + "\n";
      const newContents = await workingContents(file, cwd);

      if (!looksBinary(newContents)) {
        files.push({ path: file, oldContents: "", newContents, status: "added" });
      }
    }
  }

  return { patch: [tracked, untracked].filter(Boolean).join("\n"), files };
}
