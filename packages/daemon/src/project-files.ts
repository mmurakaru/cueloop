/** Read-only repo introspection for the Project panel: the tracked file tree and a file's contents. */

import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Ceiling on the returned tree; a pathological repo cannot flood the panel or the wire. */
const MAX_FILES = 5000;
/** Ceiling on a served file; the panel renders source, not multi-megabyte blobs. */
const MAX_FILE_BYTES = 1024 * 1024;

async function gitFileList(repoRoot: string, args: string[]): Promise<string[] | null> {
  const gitProcess = Bun.spawn(["git", "-C", repoRoot, "ls-files", "-z", ...args], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const stdout = await new Response(gitProcess.stdout).text();

  return (await gitProcess.exited) === 0 ? stdout.split("\0").filter(Boolean) : null;
}

/** Existing tracked paths, sorted ascending and capped; [] on failure or a non-repo. */
export async function listProjectFiles(repoRoot: string | undefined): Promise<string[]> {
  if (repoRoot === undefined || repoRoot.length === 0) return [];

  try {
    const [tracked, deleted] = await Promise.all([
      gitFileList(repoRoot, ["--cached"]),
      gitFileList(repoRoot, ["--deleted"]),
    ]);

    if (tracked === null || deleted === null) return [];

    const missing = new Set(deleted);

    return tracked
      .filter((path) => !missing.has(path))
      .toSorted()
      .slice(0, MAX_FILES);
  } catch {
    return [];
  }
}

/** True when `candidate` resolves outside `root` (path traversal) or is `root` itself. */
function escapesRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);

  return rel.length === 0 || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel);
}

/** UTF-8 contents of `repoRoot/path`, or null: no repo, traversal escape, not a regular file, oversized, or any error. */
export async function readProjectFile(
  repoRoot: string | undefined,
  path: string,
): Promise<string | null> {
  if (repoRoot === undefined || repoRoot.length === 0) return null;

  const root = resolve(repoRoot);
  const target = resolve(root, path);

  if (escapesRoot(root, target)) return null;

  try {
    const stats = await stat(target);

    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null;

    return await Bun.file(target).text();
  } catch {
    return null;
  }
}
