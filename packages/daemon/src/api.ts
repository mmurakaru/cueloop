/**
 * The daemon's method surface (#14). Transport-independent: the socket
 * server and the in-process test harness both call these handlers.
 * The wait contract: verdicts outlive waits - session.wait long-polls,
 * and a verdict resolved while nobody waited is delivered on next contact.
 */

import {
  SCHEMA_VERSION,
  feedbackForSession,
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

type EventListener = (e: DaemonEvent) => void;

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
    for (const l of this.listeners) l({ event, sessionId });
  }

  /** True when nothing awaits a verdict - drives idle-exit. */
  hasPendingSessions(): boolean {
    return this.store.list().some((s) => s.status === "pending");
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
    const s = this.store.get(id);
    if (!s) throw new DaemonError("not_found", `no session ${id}`);
    return s;
  }

  sessionList(filter?: { status?: "pending" | "resolved"; workspace?: Partial<WorkspaceKey> }): ReviewSession[] {
    return this.store.list().filter((s) => {
      if (filter?.status && s.status !== filter.status) return false;
      if (filter?.workspace?.repoRoot && s.workspace.repoRoot !== filter.workspace.repoRoot) return false;
      if (filter?.workspace?.branch && s.workspace.branch !== filter.workspace.branch) return false;
      return true;
    });
  }

  /**
   * Long-poll for the verdict. Resolves immediately when already resolved;
   * otherwise parks until sessionResolve fires or timeoutMs elapses (null =
   * still pending - the caller re-polls later; the verdict is never lost).
   */
  sessionWait(id: string, timeoutMs: number): Promise<ReviewSession | null> {
    const s = this.sessionGet(id);
    if (s.status === "resolved") return Promise.resolve(s);
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? [];
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        const idx = list.indexOf(waiter);
        if (idx !== -1) list.splice(idx, 1);
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
    const s = this.mutable(id);
    const existing = s.annotations.findIndex((a) => a.id === annotation.id);
    const full: Annotation = { ...annotation, createdAt: new Date().toISOString() };
    if (existing === -1) s.annotations.push(full);
    else s.annotations[existing] = { ...full, createdAt: s.annotations[existing]!.createdAt };
    this.store.upsert(s);
    this.emit("session.updated", id);
    return s;
  }

  sessionRemoveAnnotation(id: string, annotationId: string): ReviewSession {
    const s = this.mutable(id);
    s.annotations = s.annotations.filter((a) => a.id !== annotationId);
    this.store.upsert(s);
    this.emit("session.updated", id);
    return s;
  }

  /** The reviewer's working copy; undefined clears it (revert all edits). */
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined): ReviewSession {
    const s = this.mutable(id);
    if (workingCopy === undefined || workingCopy === s.artifact.content) delete s.workingCopy;
    else s.workingCopy = workingCopy;
    this.store.upsert(s);
    this.emit("session.updated", id);
    return s;
  }

  /**
   * The guided walk's viewed marks. The full list replaces the stored one
   * (last write wins - one reviewer walks at a time); an empty list clears
   * the field so untouched records stay lean. Duplicates collapse here so
   * the record never accumulates repeats from racing clients.
   */
  sessionSetViewed(id: string, viewedPaths: string[]): ReviewSession {
    const s = this.mutable(id);
    const unique = [...new Set(viewedPaths)];
    if (unique.length === 0) delete s.viewedPaths;
    else s.viewedPaths = unique;
    this.store.upsert(s);
    this.emit("session.updated", id);
    return s;
  }

  sessionResolve(id: string, verdictKind: VerdictKind, summary: string): ReviewSession {
    const s = this.mutable(id);
    const verdict: Verdict = {
      kind: verdictKind,
      summary,
      feedback: feedbackForSession(s, verdictKind, summary),
      resolvedAt: new Date().toISOString(),
    };
    s.verdict = verdict;
    s.status = "resolved";
    this.store.upsert(s);
    const parked = this.waiters.get(id) ?? [];
    this.waiters.delete(id);
    for (const w of parked) w(s);
    this.emit("session.resolved", id);
    this.emit("inbox.changed", id);
    return s;
  }

  /** Agent resubmits: new revision becomes the artifact, session reopens. */
  sessionSubmitRevision(id: string, content: string): ReviewSession {
    const s = this.sessionGet(id);
    const now = new Date().toISOString();
    s.revisions.push({ revision: s.revisions.length + 1, content, submittedAt: now });
    s.artifact = { ...s.artifact, content };
    delete s.workingCopy;
    s.verdict = null;
    s.status = "pending";
    this.store.upsert(s);
    this.emit("session.revised", id);
    this.emit("inbox.changed", id);
    return s;
  }

  private mutable(id: string): ReviewSession {
    const s = this.sessionGet(id);
    if (s.status === "resolved") throw new DaemonError("resolved", `session ${id} is already resolved`);
    return s;
  }
}

export { DaemonError };

/** Convenience for adapters: map a resolved session to the agent contract. */
export function verdictResponse(session: ReviewSession): { allow: boolean; feedback: string } {
  if (!session.verdict) throw new DaemonError("pending", "session has no verdict");
  return { allow: verdictAllows(session.verdict.kind), feedback: session.verdict.feedback };
}
