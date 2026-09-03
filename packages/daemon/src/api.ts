/**
 * The daemon's method surface. Transport-independent: the socket
 * server and the in-process test harness both call these handlers.
 * The wait contract: verdicts outlive waits - session.wait long-polls,
 * and a verdict resolved while nobody waited is delivered on next contact.
 */

import {
  SCHEMA_VERSION,
  appendEntry,
  cutBlock,
  feedbackForSession,
  historyFromLinear,
  isAddressed,
  isAgentNote,
  isMarkdownArtifact,
  MAIN_BRANCH,
  parseBlocks,
  registerParticipant,
  resolveAnchor,
  restoreBlock,
  switchBranch,
  verdictAllows,
  type Annotation,
  type HunkRejection,
  type NewEntry,
  type Artifact,
  type Identity,
  type ReviewSession,
  type Verdict,
  type VerdictKind,
  type WorkspaceKey,
} from "@cueloop/schema";
import { curateDiff } from "./curate";
import { SessionStore, withHistory } from "./store";
import { pruneExpiredSessions, resolveCleanupPeriodDays } from "./retention";
import { HerdrTabStore, type HerdrTabHandle } from "./herdr-tab-store";
import { DiffWatcher } from "./diff-watcher";
import { workingTreeDiff } from "./working-tree";
import { DaemonError } from "./errors";

export type EventName =
  | "session.created"
  | "session.updated"
  | "session.resolved"
  | "session.revised"
  | "inbox.changed";

export interface DaemonEvent {
  event: EventName;
  sessionId: string;
  /** The history entry the change appended, when it appended one. */
  entryId?: string;
}

type EventListener = (event: DaemonEvent) => void;

export class DaemonCore {
  readonly store: SessionStore;
  readonly herdrTabs: HerdrTabStore;
  private waiters = new Map<string, ((session: ReviewSession) => void)[]>();
  private listeners = new Set<EventListener>();
  private seq = 0;
  /** Drives diff hot-reload: watches each live diff session's repo for working-tree changes. */
  private readonly diffWatcher: DiffWatcher;
  /**
   * Per-diff-session capture generation. Bumped when a refresh begins; a
   * capture whose generation is stale by the time it finishes discards its
   * result, so overlapping captures never write an older patch over a newer one.
   */
  private readonly diffRefreshGenerations = new Map<string, number>();

  constructor(home: string) {
    this.store = new SessionStore(home);
    this.store.recover();
    pruneExpiredSessions(this.store, resolveCleanupPeriodDays(), Date.now());
    this.herdrTabs = new HerdrTabStore(home);
    this.diffWatcher = new DiffWatcher((repoRoot) => void this.refreshDiffsForRepo(repoRoot));
    // resume hot-reload for diff sessions that survived a daemon restart
    for (const session of this.store.list()) this.watchIfDiffSession(session);
  }

  /** Release the fs watchers behind diff hot-reload; call on daemon shutdown. */
  dispose(): void {
    this.diffWatcher.close();
  }

  /** The herdr tab opened for a review, if any (adapter scratch, not on the session). */
  herdrGetTab(sessionId: string): HerdrTabHandle | null {
    return this.herdrTabs.get(sessionId);
  }

  herdrSetTab(sessionId: string, handle: HerdrTabHandle): void {
    this.herdrTabs.set(sessionId, handle);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  private emit(event: EventName, sessionId: string, entryId?: string): void {
    const frame: DaemonEvent =
      entryId === undefined ? { event, sessionId } : { event, sessionId, entryId };

    for (const listener of this.listeners) listener(frame);
  }

  /** True when nothing awaits a verdict - drives idle-exit. */
  hasPendingSessions(): boolean {
    return this.store.list().some((session) => session.status === "pending");
  }

  sessionCreate(params: { workspace: WorkspaceKey; artifact: Artifact }): ReviewSession {
    const now = new Date().toISOString();
    const session: ReviewSession = {
      schemaVersion: SCHEMA_VERSION,
      id: `ses_${now.replace(/\D/g, "").slice(0, 14)}_${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      workspace: params.workspace,
      artifact: params.artifact,
      revisions: [{ revision: 1, content: params.artifact.content, submittedAt: now }],
      annotations: [],
      verdict: null,
      status: "pending",
      createdAt: now,
    };

    session.history = historyFromLinear(session);
    this.store.upsert(session);
    this.watchIfDiffSession(session);
    this.emit("session.created", session.id);
    this.emit("inbox.changed", session.id);

    return session;
  }

  sessionGet(id: string): ReviewSession {
    const session = this.store.get(id);

    if (!session) throw new DaemonError("not_found", `no session ${id}`);

    return session;
  }

  sessionList(filter?: {
    status?: "pending" | "resolved";
    workspace?: Partial<WorkspaceKey>;
  }): ReviewSession[] {
    return this.store.list().filter((session) => {
      if (filter?.status && session.status !== filter.status) return false;
      if (filter?.workspace?.repoRoot && session.workspace.repoRoot !== filter.workspace.repoRoot)
        return false;
      if (filter?.workspace?.branch && session.workspace.branch !== filter.workspace.branch)
        return false;

      return true;
    });
  }

  /**
   * Long-poll for the verdict. Resolves immediately when already resolved;
   * otherwise parks until sessionResolve fires or timeoutMs elapses (null =
   * still pending - the caller re-polls later; the verdict is never lost).
   */
  sessionWait(id: string, timeoutMs: number): Promise<ReviewSession | null> {
    const current = this.sessionGet(id);

    if (current.status === "resolved") return Promise.resolve(current);

    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? [];
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const waiterIndex = list.indexOf(waiter);

        if (waiterIndex !== -1) list.splice(waiterIndex, 1);
        resolve(null);
      }, timeoutMs);
      const waiter = (session: ReviewSession) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(session);
      };

      list.push(waiter);
      this.waiters.set(id, list);
    });
  }

  /**
   * `authorName` registers the annotation's author in the participant registry;
   * a bare author id (no name) keeps its short-handle fallback instead.
   */
  sessionAnnotate(
    id: string,
    annotation: Omit<Annotation, "createdAt">,
    authorName?: string,
  ): ReviewSession {
    const session = this.mutable(id);
    const existing = session.annotations.findIndex((candidate) => candidate.id === annotation.id);
    const full: Annotation = { ...annotation, createdAt: new Date().toISOString() };

    let entryId: string | undefined;

    if (existing === -1) {
      session.annotations.push(full);
      entryId = this.record(session, {
        type: "comment",
        annotationId: full.id,
        createdAt: full.createdAt,
      });
    } else
      session.annotations[existing] = {
        ...full,
        createdAt: session.annotations[existing]!.createdAt,
      };
    if (annotation.author && authorName)
      session.participants = registerParticipant(
        session,
        annotation.author,
        authorName,
      ).participants;
    this.store.upsert(session);
    this.emit("session.updated", id, entryId);

    return session;
  }

  /**
   * Remove a comment. With `onBehalfOf`, the caller is a collaborator or an
   * agent acting as that author and may remove only that author's comments;
   * the owner (no `onBehalfOf`) may remove any.
   */
  sessionRemoveAnnotation(id: string, annotationId: string, onBehalfOf?: string): ReviewSession {
    const session = this.mutable(id);
    const target = session.annotations.find((candidate) => candidate.id === annotationId);

    if (onBehalfOf !== undefined && target !== undefined && target.author !== onBehalfOf) {
      throw new DaemonError("forbidden", `${onBehalfOf} cannot remove another author's comment`);
    }
    session.annotations = session.annotations.filter((candidate) => candidate.id !== annotationId);
    const entryId =
      target === undefined
        ? undefined
        : this.record(session, {
            type: "comment-removed",
            annotationId,
            createdAt: new Date().toISOString(),
          });

    this.store.upsert(session);
    this.emit("session.updated", id, entryId);

    return session;
  }

  /** Register a display name for a participant; how a collaborator or an agent names itself. */
  sessionSetParticipantName(id: string, author: string, name: string): ReviewSession {
    const session = this.mutable(id);

    session.participants = registerParticipant(session, author, name).participants;
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  /** The reviewer's working copy; undefined clears it (revert all edits). */
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): ReviewSession {
    const session = this.mutable(id);
    const entryId = this.applyWorkingCopy(session, workingCopy);

    this.store.upsert(session);
    this.emit("session.updated", id, entryId);

    return session;
  }

  /**
   * The guided walk's viewed marks. Merge-additive: walking only ever adds
   * marks, so concurrent or stale clients converge instead of overwriting
   * each other. An empty array is the explicit reset.
   */
  sessionSetViewed(id: string, viewedPaths: string[]): ReviewSession {
    const session = this.mutable(id);

    if (viewedPaths.length === 0) delete session.viewedPaths;
    else session.viewedPaths = [...new Set([...(session.viewedPaths ?? []), ...viewedPaths])];
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  sessionSetShareId(id: string, shareId: string): ReviewSession {
    const session = this.mutable(id);

    session.shareId = shareId;
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  /** Remove a session for good (inbox delete); resolved or pending, both go. */
  sessionDelete(id: string): void {
    const session = this.store.get(id);

    if (!this.store.delete(id)) throw new DaemonError("not_found", `no session ${id}`);
    if (session) this.unwatchIfDiffSession(session);
    this.diffRefreshGenerations.delete(id);
    this.herdrTabs.delete(id);
    this.emit("inbox.changed", id);
  }

  /**
   * Cut one block of the reviewer's working copy - the `blockIndex`-th block
   * of the working text - so it serializes into the diff the agent receives.
   */
  sessionCutBlock(id: string, blockIndex: number): ReviewSession {
    const session = this.mutable(id);
    const working = session.workingCopy ?? session.artifact.content;
    const block = parseBlocks(working)[blockIndex];

    if (!block)
      throw new DaemonError("invalid_params", `no block ${blockIndex} in the working copy`);
    const entryId = this.applyWorkingCopy(session, cutBlock(working, block));

    this.store.upsert(session);
    this.emit("session.updated", id, entryId);

    return session;
  }

  /**
   * Re-insert a cut block - the `baseBlockIndex`-th block of the submitted
   * revision - into the working copy before `line` (default: the end). A copy
   * that reads as the submitted revision again is dropped, not stored.
   */
  sessionRestoreBlock(id: string, baseBlockIndex: number, line?: number): ReviewSession {
    const session = this.mutable(id);
    const base = session.artifact.content;
    const block = parseBlocks(base)[baseBlockIndex];

    if (!block) {
      throw new DaemonError(
        "invalid_params",
        `no block ${baseBlockIndex} in the submitted revision`,
      );
    }
    const working = session.workingCopy ?? base;
    const beforeLine = Math.min(line ?? working.split("\n").length, working.split("\n").length);
    const entryId = this.applyWorkingCopy(session, restoreBlock(base, working, block, beforeLine));

    this.store.upsert(session);
    this.emit("session.updated", id, entryId);

    return session;
  }

  /**
   * Replace a diff review's reject decisions; the working copy becomes the
   * patch they leave, or clears when nothing is rejected. Needs the full file
   * contents a working-tree diff carries; a PR diff cannot be curated.
   */
  sessionCurate(id: string, rejections: HunkRejection[]): ReviewSession {
    const session = this.mutable(id);

    if (session.artifact.type !== "diff") {
      throw new DaemonError("invalid_params", "only a diff review is curated by hunk");
    }
    if (!session.artifact.files) {
      throw new DaemonError("invalid_params", "hunk curation needs full file contents");
    }
    if (rejections.length === 0) delete session.curation;
    else session.curation = rejections;
    const entryId = this.applyWorkingCopy(
      session,
      rejections.length === 0 ? undefined : curateDiff(session.artifact.files, rejections),
    );

    this.store.upsert(session);
    this.emit("session.updated", id, entryId);

    return session;
  }

  /**
   * Merge a share's collaborator state back into the local session: annotations
   * union by id with existing ones (the planner's) winning, and the participant
   * registry union by id with the incoming identity winning (a collaborator is
   * the authority on their own name). This is how a teammate's name reaches the
   * planner after a pull, alongside their notes.
   */
  sessionMergeShared(
    id: string,
    incoming: { annotations: Annotation[]; participants?: Identity[] },
  ): ReviewSession {
    const session = this.mutable(id);
    const known = new Set(session.annotations.map((annotation) => annotation.id));

    for (const annotation of incoming.annotations) {
      if (known.has(annotation.id)) continue;
      session.annotations.push(annotation);
      this.record(session, {
        type: "comment",
        annotationId: annotation.id,
        createdAt: annotation.createdAt,
      });
    }
    if (incoming.participants?.length) {
      const registry = new Map(
        (session.participants ?? []).map((participant) => [participant.id, participant]),
      );

      for (const participant of incoming.participants) registry.set(participant.id, participant);
      session.participants = [...registry.values()];
    }
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  sessionResolve(id: string, verdictKind: VerdictKind, summary: string): ReviewSession {
    const session = this.mutable(id);
    const verdict: Verdict = {
      kind: verdictKind,
      summary,
      feedback: feedbackForSession(session, verdictKind, summary),
      resolvedAt: new Date().toISOString(),
    };

    session.verdict = verdict;
    session.status = "resolved";
    const entryId = this.record(session, {
      type: "verdict",
      verdict,
      createdAt: verdict.resolvedAt,
    });
    this.store.upsert(session);
    // a resolved diff review is frozen; stop hot-reloading its working tree
    this.unwatchIfDiffSession(session);
    const parked = this.waiters.get(id) ?? [];

    this.waiters.delete(id);
    for (const parkedWaiter of parked) parkedWaiter(session);
    this.emit("session.resolved", id, entryId);
    this.emit("inbox.changed", id);

    return session;
  }

  /**
   * Agent resubmits: new revision becomes the artifact, session reopens.
   * Annotations the agent reports as acted on (by id) are marked addressed,
   * and for plan revisions any still-open annotation whose quoted text no
   * longer resolves is marked addressed too ("drift" - the line it pointed at
   * was rewritten). Addressed is a marker, never a delete: the reviewer's
   * rail hides them behind a count, and the next feedback document omits them.
   * Unknown ids are ignored, so a stale id in the agent's list never fails
   * the resubmit.
   */
  sessionSubmitRevision(
    id: string,
    content: string,
    addressedAnnotationIds: string[] = [],
  ): ReviewSession {
    const session = this.sessionGet(id);
    const now = new Date().toISOString();
    const revisionNumber = session.revisions.length + 1;

    session.revisions.push({ revision: revisionNumber, content, submittedAt: now });
    session.artifact = { ...session.artifact, content };
    // the agent's revision lands on main wherever its tip sits; the artifact
    // shows the head of the branch the reviewer is on
    const entryId = this.recordOnMain(session, {
      type: "revision",
      by: "agent",
      content,
      createdAt: now,
    });
    delete session.workingCopy;
    session.verdict = null;
    session.status = "pending";

    // a reported root comment addresses its whole discussion: replies are
    // never listed on their own in the feedback document
    const reportedIds = new Set(addressedAnnotationIds);

    for (const annotation of session.annotations) {
      if (annotation.replyTo !== undefined && reportedIds.has(annotation.replyTo)) {
        reportedIds.add(annotation.id);
      }
    }
    // drift assist applies to markdown artifacts (plan, reply) only: a diff
    // revision is a whole new patch, where a vanished quote says nothing about
    // the feedback
    const revisedBlocks = isMarkdownArtifact(session.artifact.type) ? parseBlocks(content) : null;

    for (const annotation of session.annotations) {
      if (isAddressed(annotation) || isAgentNote(annotation)) continue;
      if (reportedIds.has(annotation.id)) {
        annotation.resolution = { revision: revisionNumber, source: "agent" };
      } else if (
        revisedBlocks !== null &&
        resolveAnchor(annotation.anchor, revisedBlocks) === null
      ) {
        annotation.resolution = { revision: revisionNumber, source: "drift" };
      }
    }

    this.store.upsert(session);
    this.emit("session.revised", id, entryId);
    this.emit("inbox.changed", id);

    return session;
  }

  /** Re-capture a diff session's working tree; broadcasts session.updated only when the patch moved. */
  async sessionRefreshDiff(id: string): Promise<{ changed: boolean }> {
    const session = this.mutable(id);

    if (session.artifact.type !== "diff") return { changed: false };
    const generation = (this.diffRefreshGenerations.get(id) ?? 0) + 1;

    this.diffRefreshGenerations.set(id, generation);
    const diff = await workingTreeDiff(session.workspace.repoRoot);

    // The capture yields the event loop: a newer refresh may have started, or a
    // concurrent resolve/delete may have closed the session. Discard a stale
    // capture, and re-read so a resolved review is never mutated and a deleted
    // one is never revived by this upsert.
    if (this.diffRefreshGenerations.get(id) !== generation) return { changed: false };
    const current = this.store.get(id);

    if (!current || current.status !== "pending" || current.artifact.type !== "diff")
      return { changed: false };
    if (diff.patch === current.artifact.content) return { changed: false };
    current.artifact = { ...current.artifact, content: diff.patch, files: diff.files };
    this.store.upsert(current);
    this.emit("session.updated", id);

    return { changed: true };
  }

  /** Re-capture every live diff session sharing a repo root (one debounced fs change). */
  private async refreshDiffsForRepo(repoRoot: string): Promise<void> {
    const live = this.store
      .list()
      .filter((session) => isLiveDiffSession(session) && session.workspace.repoRoot === repoRoot);

    for (const session of live) {
      // a session resolved or deleted between the change and this tick just skips
      try {
        await this.sessionRefreshDiff(session.id);
      } catch {
        // no-op: the session is gone or already resolved
      }
    }
  }

  private watchIfDiffSession(session: ReviewSession): void {
    if (isLiveDiffSession(session))
      this.diffWatcher.trackDiffRepo(session.workspace.repoRoot, session.id);
  }

  private unwatchIfDiffSession(session: ReviewSession): void {
    if (session.artifact.type === "diff")
      this.diffWatcher.untrackDiffRepo(session.workspace.repoRoot, session.id);
  }

  /**
   * Set or clear the working copy and, when the reviewer's text changed, record
   * it as a reviewer revision on the current branch. Returns that entry's id.
   */
  private applyWorkingCopy(
    session: ReviewSession,
    workingCopy: string | undefined,
  ): string | undefined {
    const before = session.workingCopy ?? session.artifact.content;
    const next =
      workingCopy === undefined || workingCopy === session.artifact.content
        ? undefined
        : workingCopy;

    if (next === undefined) delete session.workingCopy;
    else session.workingCopy = next;
    const after = next ?? session.artifact.content;

    if (after === before) return undefined;

    return this.record(session, {
      type: "revision",
      by: "reviewer",
      content: after,
      createdAt: new Date().toISOString(),
    });
  }

  /** Append an entry on the session's current branch; a session without a head has no history to extend. */
  private record(session: ReviewSession, entry: NewEntry): string | undefined {
    const history = withHistory(session).history;

    if (!history) return undefined;
    const appended = appendEntry(history, entry);

    session.history = appended.history;

    return appended.entry.id;
  }

  /** Append an entry on main, leaving the reviewer's current branch where it is. */
  private recordOnMain(session: ReviewSession, entry: NewEntry): string | undefined {
    const history = withHistory(session).history;

    if (!history) return undefined;
    const appended = appendEntry(switchBranch(history, MAIN_BRANCH), entry);

    session.history = { ...appended.history, branch: history.branch };

    return appended.entry.id;
  }

  private mutable(id: string): ReviewSession {
    const session = this.sessionGet(id);

    if (session.status === "resolved")
      throw new DaemonError("resolved", `session ${id} is already resolved`);

    return session;
  }
}

export { DaemonError };

/** A pending diff session: the state that warrants hot-reload watching of its working tree. */
function isLiveDiffSession(session: ReviewSession): boolean {
  return session.status === "pending" && session.artifact.type === "diff";
}

/** Convenience for adapters: map a resolved session to the agent contract. */
export function verdictResponse(session: ReviewSession) {
  if (!session.verdict) throw new DaemonError("pending", "session has no verdict");

  return { allow: verdictAllows(session.verdict.kind), feedback: session.verdict.feedback };
}
