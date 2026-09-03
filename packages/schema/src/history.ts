/**
 * A review session's history as an append-only tree of entries. Each entry
 * points at its parent; a branch is a named tip; the active path is the chain
 * from the current branch's tip back to the root. Nothing is ever deleted:
 * navigating moves a tip, a comment removal is its own entry, a fork copies a
 * path into a new history. Every view of the session - the artifact text,
 * the open comments, the verdict history - derives from the active path.
 *
 * Pure: no store, no daemon. The daemon owns persistence; the client and the
 * feedback document read what this module derives.
 */

import type { Annotation, ReviewSession, Verdict } from "./types";

export type EntryAuthor = "agent" | "reviewer";

interface EntryBase {
  id: string;
  /** null on the root entry. */
  parentId: string | null;
  createdAt: string;
}

export type SessionEntry =
  | (EntryBase & { type: "revision"; by: EntryAuthor; content: string })
  | (EntryBase & { type: "comment"; annotationId: string })
  | (EntryBase & { type: "comment-removed"; annotationId: string })
  | (EntryBase & { type: "verdict"; verdict: Verdict })
  | (EntryBase & { type: "branch-summary"; text: string; abandoned: string[] });

export type EntryType = SessionEntry["type"];

/** Omit that keeps a discriminated union's members apart. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** An entry as a caller describes it: the tree pointers are the history's business. */
export type NewEntry = DistributiveOmit<SessionEntry, "id" | "parentId"> & { id?: string };

export interface AppendResult {
  history: SessionHistory;
  entry: SessionEntry;
}

/** The agent's line; every other branch is the reviewer's. */
export const MAIN_BRANCH = "main";

export interface SessionHistory {
  entries: SessionEntry[];
  /** Named tips; `main` always exists. */
  tips: Record<string, string>;
  /** The branch whose path the session shows. */
  branch: string;
  /** Checkpoints: an entry id to the name a reviewer gave it. */
  labels: Record<string, string>;
}

let entrySeq = 0;

export function newEntryId(): string {
  return `e_${Date.now().toString(36)}${(entrySeq++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export class HistoryError extends Error {
  constructor(
    readonly code:
      | "unknown-entry"
      | "unknown-branch"
      | "branch-exists"
      | "off-path"
      | "already-there"
      | "not-a-revision",
    message: string,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ reads */

export function entryOf(history: SessionHistory, id: string): SessionEntry | undefined {
  return history.entries.find((entry) => entry.id === id);
}

export function tipOf(history: SessionHistory, branch: string = history.branch): string {
  const tip = history.tips[branch];

  if (tip === undefined) throw new HistoryError("unknown-branch", `no branch "${branch}"`);

  return tip;
}

/** The entries from `fromId` (default: the current tip) back to the root, root first. */
export function pathOf(history: SessionHistory, fromId: string = tipOf(history)): SessionEntry[] {
  const byId = new Map(history.entries.map((entry) => [entry.id, entry]));
  const path: SessionEntry[] = [];

  for (
    let entry = byId.get(fromId);
    entry;
    entry = entry.parentId ? byId.get(entry.parentId) : undefined
  ) {
    path.unshift(entry);
  }

  return path;
}

export interface DerivedPath {
  /** The last revision on the path: what the artifact shows. */
  head: SessionEntry & { type: "revision" };
  /** Comments added on the path and not removed after, in order. */
  openAnnotationIds: string[];
  /** Verdicts on the path, oldest first. */
  verdicts: Verdict[];
  summaries: Array<SessionEntry & { type: "branch-summary" }>;
  /** Agent revisions on the path: one per round. */
  rounds: number;
}

/** Everything a viewer sees on the current path, folded from its entries. */
export function derivePath(history: SessionHistory, fromId?: string): DerivedPath {
  const path = pathOf(history, fromId);
  const revisions = path.filter((entry) => entry.type === "revision");
  const head = revisions.at(-1);

  if (!head) throw new HistoryError("not-a-revision", "a path without a revision has no head");
  const open = new Set<string>();
  const verdicts: Verdict[] = [];
  const summaries: Array<SessionEntry & { type: "branch-summary" }> = [];

  for (const entry of path) {
    if (entry.type === "comment") open.add(entry.annotationId);
    if (entry.type === "comment-removed") open.delete(entry.annotationId);
    if (entry.type === "verdict") verdicts.push(entry.verdict);
    if (entry.type === "branch-summary") summaries.push(entry);
  }

  return {
    head,
    openAnnotationIds: [...open],
    verdicts,
    summaries,
    rounds: revisions.filter((entry) => entry.by === "agent").length,
  };
}

/* ----------------------------------------------------------------- writes */

/** Append an entry after the current branch's tip and move the tip onto it. */
export function appendEntry(history: SessionHistory, entry: NewEntry): AppendResult {
  const parentId = tipOf(history);
  // SAFETY: the spread keeps `type` and its fields intact; only the tree
  // pointers are added, which the union's every member carries
  const full = { ...entry, id: entry.id ?? newEntryId(), parentId } as SessionEntry;

  return {
    history: {
      ...history,
      entries: [...history.entries, full],
      tips: { ...history.tips, [history.branch]: full.id },
    },
    entry: full,
  };
}

/** Name the current tip as a checkpoint. */
export function labelTip(history: SessionHistory, label: string): SessionHistory {
  return { ...history, labels: { ...history.labels, [tipOf(history)]: label } };
}

/** Start a branch at the current tip and switch to it; `main` is untouched. */
export function createBranch(history: SessionHistory, name: string): SessionHistory {
  if (history.tips[name] !== undefined) {
    throw new HistoryError("branch-exists", `branch "${name}" exists`);
  }

  return { ...history, tips: { ...history.tips, [name]: tipOf(history) }, branch: name };
}

export function switchBranch(history: SessionHistory, name: string): SessionHistory {
  tipOf(history, name);

  return { ...history, branch: name };
}

export interface NavigateOptions {
  /** Record the abandoned segment as a branch summary parented at the target. */
  summary?: string;
  createdAt?: string;
}

/**
 * Move the current branch's tip to an earlier entry on its path. The entries
 * after it stay in the tree; with a summary, a branch-summary entry that
 * names them is appended at the target and becomes the tip.
 */
export function navigateTo(
  history: SessionHistory,
  targetId: string,
  options: NavigateOptions = {},
): SessionHistory {
  if (!entryOf(history, targetId)) {
    throw new HistoryError("unknown-entry", `no entry "${targetId}"`);
  }
  const tip = tipOf(history);

  if (targetId === tip) throw new HistoryError("already-there", "already at that entry");
  const path = pathOf(history);
  const index = path.findIndex((entry) => entry.id === targetId);

  if (index === -1) {
    throw new HistoryError(
      "off-path",
      `"${targetId}" is not on branch "${history.branch}" - switch branch first`,
    );
  }
  const abandoned = path.slice(index + 1).map((entry) => entry.id);
  const moved: SessionHistory = {
    ...history,
    tips: { ...history.tips, [history.branch]: targetId },
  };

  if (options.summary === undefined) return moved;

  return appendEntry(moved, {
    type: "branch-summary",
    text: options.summary,
    abandoned,
    createdAt: options.createdAt ?? new Date().toISOString(),
  }).history;
}

/**
 * A fork's history: the current path copied as one branch, keeping comments
 * and labels on it, dropping verdicts, with the tip at the copied head.
 */
export function forkHistory(history: SessionHistory): SessionHistory {
  const kept = pathOf(history).filter((entry) => entry.type !== "verdict");
  const labels: Record<string, string> = {};

  for (const entry of kept) {
    const label = history.labels[entry.id];

    if (label !== undefined) labels[entry.id] = label;
  }
  const tip = kept.at(-1);

  if (!tip) throw new HistoryError("not-a-revision", "nothing to fork");

  return { entries: kept, tips: { [MAIN_BRANCH]: tip.id }, branch: MAIN_BRANCH, labels };
}

/* -------------------------------------------------------------- migration */

/**
 * A linear session as a one-branch tree: its revisions chained on `main` as
 * agent revisions, its comments attached after the revision that was current
 * when they were made, its verdict (when resolved) after the last revision.
 * Deterministic: the same record migrates to the same ids.
 */
export function historyFromLinear(
  session: Pick<ReviewSession, "id" | "revisions" | "annotations" | "verdict" | "createdAt">,
): SessionHistory {
  const entries: SessionEntry[] = [];
  let parentId: string | null = null;
  const push = (entry: DistributiveOmit<SessionEntry, "parentId">): void => {
    // SAFETY: only the parent pointer is added; the union member is untouched
    const full = { ...entry, parentId } as SessionEntry;

    entries.push(full);
    parentId = full.id;
  };
  const revisions = [...session.revisions].sort((left, right) => left.revision - right.revision);
  const comments = [...session.annotations].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  let nextComment = 0;

  revisions.forEach((revision, index) => {
    push({
      id: `${session.id}_rev${revision.revision}`,
      type: "revision",
      by: "agent",
      content: revision.content,
      createdAt: revision.submittedAt,
    });
    const until = revisions[index + 1]?.submittedAt;

    while (
      nextComment < comments.length &&
      (until === undefined || comments[nextComment]!.createdAt < until)
    ) {
      const annotation: Annotation = comments[nextComment]!;

      push({
        id: `${session.id}_com_${annotation.id}`,
        type: "comment",
        annotationId: annotation.id,
        createdAt: annotation.createdAt,
      });
      nextComment++;
    }
  });
  if (session.verdict) {
    push({
      id: `${session.id}_verdict`,
      type: "verdict",
      verdict: session.verdict,
      createdAt: session.verdict.resolvedAt,
    });
  }
  const tip = entries.at(-1);

  if (!tip) throw new HistoryError("not-a-revision", `session ${session.id} has no revision`);

  return { entries, tips: { [MAIN_BRANCH]: tip.id }, branch: MAIN_BRANCH, labels: {} };
}
