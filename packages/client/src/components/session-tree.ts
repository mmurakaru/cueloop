/**
 * Groups the pending inbox into Projects and Threads for the sidebar. Threads
 * whose workspace carries a rootCommit gather under their project (keyed by that
 * commit, so moving or re-cloning the repo never forks it); the rest are
 * standalone Threads. The flat `ordered` sequence is what the inbox cursor
 * walks, so the keyboard grammar keeps a single index across the two groups.
 */

import type { ReviewSession, WorkspaceKey } from "@cueloop/schema";

/** A repo's display name: the remote basename when present, else the working-tree folder name. */
export function projectName(workspace: WorkspaceKey): string {
  const { remote, repoRoot } = workspace;

  if (remote !== undefined) {
    const cleaned = remote.replace(/\.git$/, "").replace(/\/+$/, "");
    const base = cleaned
      .split(/[/:]/)
      .filter((part) => part.length > 0)
      .at(-1);
    if (base !== undefined) return base;
  }

  const dir = repoRoot
    .replace(/\/+$/, "")
    .split("/")
    .filter((part) => part.length > 0)
    .at(-1);

  return dir ?? repoRoot;
}

export type InboxRow =
  | { kind: "section"; id: string; label: string }
  | { kind: "project"; id: string; label: string }
  | { kind: "thread"; id: string; session: ReviewSession; selectionIndex: number };

export interface GroupedInbox {
  rows: InboxRow[];
  /** Threads in display order; the inbox cursor indexes this. */
  ordered: ReviewSession[];
}

function threadTitle(session: ReviewSession): string {
  return session.artifact.meta.title ?? session.id;
}

interface ProjectGroup {
  name: string;
  sessions: ReviewSession[];
}

/** Group pending sessions into Pinned, then Projects (by root commit), then standalone Threads. */
export function groupInbox(
  sessions: readonly ReviewSession[],
  pinnedIds?: ReadonlySet<string>,
): GroupedInbox {
  const pinned: ReviewSession[] = [];
  const projects = new Map<string, ProjectGroup>();
  const standalone: ReviewSession[] = [];

  for (const session of sessions) {
    if (pinnedIds?.has(session.id) === true) {
      pinned.push(session);
      continue;
    }

    const key = session.workspace.rootCommit;
    if (key === undefined) {
      standalone.push(session);
      continue;
    }

    const existing = projects.get(key);
    if (existing !== undefined) existing.sessions.push(session);
    else projects.set(key, { name: projectName(session.workspace), sessions: [session] });
  }

  const rows: InboxRow[] = [];
  const ordered: ReviewSession[] = [];
  const pushThread = (session: ReviewSession): void => {
    rows.push({ kind: "thread", id: session.id, session, selectionIndex: ordered.length });
    ordered.push(session);
  };

  if (pinned.length > 0) {
    rows.push({ kind: "section", id: "section:pinned", label: "Pinned" });
    for (const session of pinned) pushThread(session);
  }

  const projectEntries = [...projects.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  if (projectEntries.length > 0) {
    rows.push({ kind: "section", id: "section:projects", label: "Projects" });
    for (const [key, project] of projectEntries) {
      rows.push({ kind: "project", id: `project:${key}`, label: project.name });
      for (const session of project.sessions) pushThread(session);
    }
  }

  if (standalone.length > 0) {
    rows.push({ kind: "section", id: "section:threads", label: "Threads" });
    for (const session of standalone) pushThread(session);
  }

  return { rows, ordered };
}

export { threadTitle };
