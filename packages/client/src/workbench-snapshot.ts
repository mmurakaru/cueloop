import type { DiffFileContents, Thread } from "@cueloop/schema";

/** Reads the live working-tree diff for a repo root (the daemon's `repo.diff` RPC). */
export type RepoDiff = (repoRoot: string) => Promise<{
  patch: string;
  files: DiffFileContents[];
}>;

/**
 * Freeze a workbench thread's live working-tree diff into its artifact for a remote reviewer, who cannot
 * see the owner's tree. Dropping `meta.workbench` routes the remote through the frozen-diff render path,
 * so the snapshot stays stable no matter how the owner edits on. Any other thread is already stable and
 * passes through untouched; the owner's own session keeps the original live thread.
 */
export async function snapshotWorkbench(session: Thread, repoDiff: RepoDiff): Promise<Thread> {
  if (session.artifact.type !== "diff" || session.artifact.meta.workbench !== true) return session;
  const { patch, files } = await repoDiff(session.workspace.repoRoot);
  const { workbench: _frozen, ...meta } = session.artifact.meta;

  return { ...session, artifact: { ...session.artifact, content: patch, files, meta } };
}
