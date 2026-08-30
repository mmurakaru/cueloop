/**
 * The daemon's method surface. Transport-independent: the socket
 * server and the in-process test harness both call these handlers.
 * The wait contract: verdicts outlive waits - session.wait long-polls,
 * and a verdict resolved while nobody waited is delivered on next contact.
 */

import {
  SCHEMA_VERSION,
  feedbackForSession,
  isAddressed,
  isAgentNote,
  isMarkdownArtifact,
  parseBlocks,
  registerParticipant,
  resolveAnchor,
  verdictAllows,
  type Annotation,
  type Artifact,
  type Identity,
  type ReviewSession,
  type Verdict,
  type VerdictKind,
  type WorkspaceKey,
} from "@cueloop/schema";
import { SessionStore } from "./store";
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

  private emit(event: EventName, sessionId: string): void {
    for (const listener of this.listeners) listener({ event, sessionId });
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

    if (existing === -1) session.annotations.push(full);
    else
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
    this.emit("session.updated", id);

    return session;
  }

  sessionRemoveAnnotation(id: string, annotationId: string): ReviewSession {
    const session = this.mutable(id);

    session.annotations = session.annotations.filter((candidate) => candidate.id !== annotationId);
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  /** The reviewer's working copy; undefined clears it (revert all edits). */
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): ReviewSession {
    const session = this.mutable(id);

    if (workingCopy === undefined || workingCopy === session.artifact.content)
      delete session.workingCopy;
    else session.workingCopy = workingCopy;
    this.store.upsert(session);
    this.emit("session.updated", id);

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

    for (const annotation of incoming.annotations)
      if (!known.has(annotation.id)) session.annotations.push(annotation);
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
    this.store.upsert(session);
    // a resolved diff review is frozen; stop hot-reloading its working tree
    this.unwatchIfDiffSession(session);
    const parked = this.waiters.get(id) ?? [];

    this.waiters.delete(id);
    for (const parkedWaiter of parked) parkedWaiter(session);
    this.emit("session.resolved", id);
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
    delete session.workingCopy;
    session.verdict = null;
    session.status = "pending";

    const reportedIds = new Set(addressedAnnotationIds);
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
    this.emit("session.revised", id);
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
export function verdictResponse(session: ReviewSession): { allow: boolean; feedback: string } {
  if (!session.verdict) throw new DaemonError("pending", "session has no verdict");

  return { allow: verdictAllows(session.verdict.kind), feedback: session.verdict.feedback };
}
