/** Native Jujutsu capture pinned to one commit after its working-copy snapshot. */

import type { DiffFileContents, DiffFileStatus } from "@cueloop/schema";
import type { VcsAdapter, VcsDiffSnapshot } from "@cueloop/extension-api";

async function jj(args: string[], cwd: string): Promise<string | null> {
  try {
    const child = Bun.spawn(["jj", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const output = await new Response(child.stdout).text();

    return (await child.exited) === 0 ? output : null;
  } catch {
    return null;
  }
}

const JJ_DIFF_FILES_TEMPLATE = 'status_char ++ "\\x00" ++ path.display() ++ "\\x00"';
const JJ_FILE_LIST_TEMPLATE = 'path.display() ++ "\\x00"';

function jjSummary(text: string): { path: string; status: DiffFileStatus; curatable: boolean }[] {
  const tokens = text.split("\0");
  const changes: { path: string; status: DiffFileStatus; curatable: boolean }[] = [];

  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const code = tokens[index];
    const path = tokens[index + 1];

    if (!code || !path) continue;
    changes.push({
      path,
      status: code === "A" ? "added" : code === "D" ? "deleted" : "modified",
      curatable: code === "A" || code === "M" || code === "D",
    });
  }

  return changes;
}

function isBinary(contents: string): boolean {
  return contents.includes("\0");
}

async function jjFileContents(
  root: string,
  revision: string,
  path: string,
): Promise<string | null> {
  return jj(["--ignore-working-copy", "file", "show", "-r", revision, "--", path], root);
}

async function captureJjRevision(repoRoot: string, revset: string): Promise<VcsDiffSnapshot> {
  const identity = await jj(
    [
      "log",
      "-r",
      revset,
      "-T",
      'change_id ++ "\\n" ++ commit_id ++ "\\n" ++ parents.map(|c| c.commit_id()).join(",") ++ "\\n"',
      "--no-graph",
    ],
    repoRoot,
  );

  if (!identity) throw new Error(`Jujutsu diff capture failed: could not resolve ${revset}`);
  const lines = identity.trim().split("\n");

  if (lines.length !== 3) throw new Error(`Jujutsu change is ambiguous: ${revset}`);
  const [changeId, revisionId, parents] = lines;

  if (!changeId || !revisionId) throw new Error("Jujutsu diff capture failed: invalid identity");
  const [patch, summary] = await Promise.all([
    jj(["--ignore-working-copy", "diff", "--git", "-r", revisionId], repoRoot),
    jj(["--ignore-working-copy", "diff", "-T", JJ_DIFF_FILES_TEMPLATE, "-r", revisionId], repoRoot),
  ]);

  if (patch === null || summary === null)
    throw new Error("Jujutsu diff capture failed: could not read pinned revision");
  const files: DiffFileContents[] = [];
  const parent = parents?.split(",")[0];

  if (parent && !parents?.includes(",")) {
    for (const change of jjSummary(summary)) {
      if (!change.curatable) continue;
      const oldContents =
        change.status === "added" ? "" : await jjFileContents(repoRoot, parent, change.path);
      const newContents =
        change.status === "deleted" ? "" : await jjFileContents(repoRoot, revisionId, change.path);

      if (oldContents === null || newContents === null) continue;
      if (isBinary(oldContents) || isBinary(newContents)) continue;
      files.push({ path: change.path, oldContents, newContents, status: change.status });
    }
  }

  return { patch: patch.replace(/\n+$/, ""), files, source: { changeId, revisionId } };
}

/** Built-in jj adapter uses native change and commit IDs in a colocated checkout. */
export const jjVcsAdapter: VcsAdapter = {
  apiVersion: 1,
  id: "jj",
  async detect(cwd) {
    const root = await jj(["--ignore-working-copy", "root"], cwd);

    return root?.trim() ?? null;
  },
  captureWorkingDiff(repoRoot) {
    return captureJjRevision(repoRoot, "@");
  },
  captureChange(repoRoot, changeId) {
    if (!/^[a-z]{32}$/.test(changeId)) throw new Error(`Jujutsu change ID is invalid: ${changeId}`);

    return captureJjRevision(repoRoot, changeId);
  },
  async listChanges(repoRoot) {
    const summary = await jj(["diff", "-T", JJ_DIFF_FILES_TEMPLATE, "-r", "@"], repoRoot);

    if (summary === null) throw new Error("Jujutsu changes list failed");

    return jjSummary(summary).map(({ path, status }) => ({ path, status }));
  },
  async listFiles(repoRoot) {
    const files = await jj(["file", "list", "-T", JJ_FILE_LIST_TEMPLATE, "-r", "@"], repoRoot);

    if (files === null) throw new Error("Jujutsu project files failed");

    return files.split("\0").filter(Boolean).toSorted().slice(0, 5000);
  },
};
