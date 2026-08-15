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
  parseBlocks,
  resolveAnchor,
  verdictAllows,
  type Annotation,
  type Artifact,
  type ReviewSession,
  type Verdict,
  type VerdictKind,
  type WorkspaceKey,
} from "@cueloop/schema";
import { SessionStore } from "./store";
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
  private waiters = new Map<string, ((session: ReviewSession) => void)[]>();
  private listeners = new Set<EventListener>();
  private seq = 0;

  constructor(home: string) {
    this.store = new SessionStore(home);
    this.store.recover();
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
    this.emit("session.created", session.id);
    this.emit("inbox.changed", session.id);
    return session;
  }

  sessionGet(id: string): ReviewSession {
    const session = this.store.get(id);
    if (!session) throw new DaemonError("not_found", `no session ${id}`);
    return session;
  }

  sessionList(filter?: { status?: "pending" | "resolved"; workspace?: Partial<WorkspaceKey> }): ReviewSession[] {
    return this.store.list().filter((session) => {
      if (filter?.status && session.status !== filter.status) return false;
      if (filter?.workspace?.repoRoot && session.workspace.repoRoot !== filter.workspace.repoRoot) return false;
      if (filter?.workspace?.branch && session.workspace.branch !== filter.workspace.branch) return false;
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

  sessionAnnotate(id: string, annotation: Omit<Annotation, "createdAt">): ReviewSession {
    const session = this.mutable(id);
    const existing = session.annotations.findIndex((candidate) => candidate.id === annotation.id);
    const full: Annotation = { ...annotation, createdAt: new Date().toISOString() };
    if (existing === -1) session.annotations.push(full);
    else session.annotations[existing] = { ...full, createdAt: session.annotations[existing]!.createdAt };
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
    if (workingCopy === undefined || workingCopy === session.artifact.content) delete session.workingCopy;
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

  /** Union incoming annotations in by id; existing ids (the planner's) win. */
  sessionMergeAnnotations(id: string, incoming: Annotation[]): ReviewSession {
    const session = this.mutable(id);
    const known = new Set(session.annotations.map((annotation) => annotation.id));
    for (const annotation of incoming) if (!known.has(annotation.id)) session.annotations.push(annotation);
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
  sessionSubmitRevision(id: string, content: string, addressedAnnotationIds: string[] = []): ReviewSession {
    const session = this.sessionGet(id);
    const now = new Date().toISOString();
    const revisionNumber = session.revisions.length + 1;
    session.revisions.push({ revision: revisionNumber, content, submittedAt: now });
    session.artifact = { ...session.artifact, content };
    delete session.workingCopy;
    session.verdict = null;
    session.status = "pending";

    const reportedIds = new Set(addressedAnnotationIds);
    // drift assist applies to plans only: a diff revision is a whole new
    // patch, where a vanished quote says nothing about the feedback
    const revisedBlocks = session.artifact.type === "plan" ? parseBlocks(content) : null;
    for (const annotation of session.annotations) {
      if (isAddressed(annotation) || isAgentNote(annotation)) continue;
      if (reportedIds.has(annotation.id)) {
        annotation.resolution = { revision: revisionNumber, source: "agent" };
      } else if (revisedBlocks !== null && resolveAnchor(annotation.anchor, revisedBlocks) === null) {
        annotation.resolution = { revision: revisionNumber, source: "drift" };
      }
    }

    this.store.upsert(session);
    this.emit("session.revised", id);
    this.emit("inbox.changed", id);
    return session;
  }

  private mutable(id: string): ReviewSession {
    const session = this.sessionGet(id);
    if (session.status === "resolved") throw new DaemonError("resolved", `session ${id} is already resolved`);
    return session;
  }
}

export { DaemonError };

/** Convenience for adapters: map a resolved session to the agent contract. */
export function verdictResponse(session: ReviewSession): { allow: boolean; feedback: string } {
  if (!session.verdict) throw new DaemonError("pending", "session has no verdict");
  return { allow: verdictAllows(session.verdict.kind), feedback: session.verdict.feedback };
}
