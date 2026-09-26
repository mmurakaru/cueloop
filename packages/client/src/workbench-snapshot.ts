import {
  recaptureMainHead,
  type DiffFileContents,
  type DiffSource,
  type Thread,
} from "@cueloop/schema";

/** Reads the live working-tree diff for a repo root (the daemon's `repo.diff` RPC). */
export type RepoDiff = (
  repoRoot: string,
  vcs?: string,
) => Promise<{
  patch: string;
  files: DiffFileContents[];
  source?: Omit<DiffSource, "vcs">;
  vcs?: string;
}>;

/**
 * Freeze a workbench thread's live working-tree diff into its artifact for a remote reviewer, who cannot
 * see the owner's tree. The `snapshot` marker pins the render to this captured diff while keeping the
 * workbench marker, so the reviewer still sees the file-targeted feedback already on the thread. Any other
 * thread is already stable and passes through; the owner's own session keeps the original live thread.
 */
export async function snapshotWorkbench(session: Thread, repoDiff: RepoDiff): Promise<Thread> {
  if (session.artifact.type !== "diff" || session.artifact.meta.workbench !== true) return session;

  const { patch, files, source, vcs } = await repoDiff(
    session.workspace.repoRoot,
    session.artifact.meta.vcs,
  );
  const provider = vcs ?? session.artifact.meta.vcs;
  const artifact = {
    ...session.artifact,
    content: patch,
    files,
    meta: {
      ...session.artifact.meta,
      snapshot: true,
      vcs: provider,
      vcsChangeId: source?.changeId,
      vcsRevisionId: source?.revisionId,
    },
  };
  // the share path rebuilds content from history; recapture the branch head so it matches the fresh patch
  const history = session.history ? recaptureMainHead(session.history, patch) : session.history;
  const revisions = session.revisions.map((revision, index) =>
    index === session.revisions.length - 1
      ? {
          ...revision,
          content: patch,
          files,
          source: provider && source ? { vcs: provider, ...source } : undefined,
        }
      : revision,
  );

  return { ...session, artifact, history, revisions };
}
