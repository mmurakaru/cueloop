/**
 * A SessionClient backed by one decrypted blob instead of the local daemon.
 * This is the swap that lets the gateway render the real <App> against a share:
 * the controller asks for a session, this hands back the one it holds.
 *
 * Two modes. An observer (no write-back) rejects every mutation - the read-only
 * viewer. A collaborator (with write-back) can annotate: each annotate is a
 * read-modify-write against the stored blob (get -> open -> union by id -> seal
 * -> put), so the planner's annotations are never lost and concurrent
 * collaborators converge (ADR 0003's id-stable union). Each collaborator note
 * is stamped with their SSH fingerprint; they can only edit or delete their own.
 * Plan edits and agent verdicts stay rejected - a share has neither.
 */

import {
  appendEntry,
  registerParticipant,
  type Annotation,
  type NewEntry,
  type ReviewSession,
} from "@cueloop/schema";
import type { EventFrame, SessionClient } from "@cueloop/daemon/client";
import { packSessionBlob, unpackSessionBlob } from "@cueloop/daemon/share-blob";
import { openBlob, sealBlob } from "./crypto";
import type { ShareChangeFeed, ShareStore } from "./store";

/** Present when the viewer may write annotations back to the store. */
export interface ShareWriteBack {
  store: ShareStore;
  masterKey: Buffer;
  shareId: string;
  /** The collaborator's SSH fingerprint, stamped on the notes they author. */
  author: string;
  /** Timestamp source; injectable so tests are deterministic. */
  now?: () => string;
  /** When present, the viewer follows the share live: each write re-reads the blob and emits session.updated. */
  changes?: ShareChangeFeed;
}

export class BlobSessionClient implements SessionClient {
  private session: ReviewSession;
  private readonly listeners = new Set<(event: EventFrame) => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    session: ReviewSession,
    private readonly writeBack?: ShareWriteBack,
  ) {
    this.session = session;
  }

  onEvent(listener: (event: EventFrame) => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  async subscribe(): Promise<void> {
    const changes = this.writeBack?.changes;

    if (!changes || this.unsubscribe) return;
    this.unsubscribe = changes.subscribe(this.writeBack!.shareId, () => void this.refresh());
  }

  /** Re-read the stored blob after another writer changed it, then tell the controller. */
  private async refresh(): Promise<void> {
    const writeBack = this.writeBack;

    if (!writeBack) return;
    try {
      const stored = await writeBack.store.get(writeBack.shareId);

      if (!stored) return;
      this.session = unpackSessionBlob(openBlob(writeBack.masterKey, writeBack.shareId, stored));
    } catch {
      // a torn read is retried by the next change; the current session stays
      return;
    }
    for (const listener of this.listeners) {
      listener({ event: "session.updated", sessionId: this.session.id });
    }
  }

  async sessionGet(_id: string): Promise<ReviewSession> {
    return this.session;
  }

  async sessionList(): Promise<ReviewSession[]> {
    return [this.session];
  }

  async sessionAnnotate(
    _id: string,
    annotation: Omit<Annotation, "createdAt">,
  ): Promise<ReviewSession> {
    const writeBack = this.requireWriteBack();

    return this.commit(writeBack, (session) => upsertAnnotation(session, annotation, writeBack));
  }

  async sessionRemoveAnnotation(_id: string, annotationId: string): Promise<ReviewSession> {
    const writeBack = this.requireWriteBack();

    return this.commit(writeBack, (session) =>
      removeOwnAnnotation(
        session,
        annotationId,
        writeBack.author,
        writeBack.now?.() ?? new Date().toISOString(),
      ),
    );
  }

  sessionSetWorkingCopy(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionCutBlock(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionRestoreBlock(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionCurate(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionSetViewed(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionSetTitle(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionNavigate(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionBranch(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionSwitch(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionLabel(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionFork(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionSetShareId(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionMergeShared(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  sessionDelete(): Promise<never> {
    return rejectReadOnly();
  }

  async sessionSetSelfName(_id: string, name: string): Promise<ReviewSession> {
    const writeBack = this.requireWriteBack();

    return this.commit(writeBack, (session) =>
      registerParticipant(session, writeBack.author, name),
    );
  }

  sessionResolve(): Promise<ReviewSession> {
    return rejectReadOnly();
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }

  private requireWriteBack(): ShareWriteBack {
    if (!this.writeBack) throw new Error("this shared plan is read-only");

    return this.writeBack;
  }

  /**
   * Read the current stored blob, apply `change`, and re-store it. Reading fresh
   * each time (not from `this.session`) folds in notes other collaborators saved
   * since this session loaded, so the common case unions rather than clobbers.
   * There is no compare-and-swap: two writes that interleave inside one
   * get/put window still last-write-wins, dropping the first note. Acceptable at
   * single-owner scale; a conditional put (R2 ETag) is the fix if it ever bites.
   * The updated session becomes the render source.
   */
  private async commit(
    writeBack: ShareWriteBack,
    change: (session: ReviewSession) => ReviewSession,
  ): Promise<ReviewSession> {
    const stored = await writeBack.store.get(writeBack.shareId);
    const current = stored
      ? unpackSessionBlob(openBlob(writeBack.masterKey, writeBack.shareId, stored))
      : this.session;
    const next = change(current);

    await writeBack.store.put(
      writeBack.shareId,
      sealBlob(writeBack.masterKey, writeBack.shareId, packSessionBlob(next)),
    );
    this.session = next;

    return next;
  }
}

/** Union a collaborator's annotation in by id, guarding others' notes. */
function upsertAnnotation(
  session: ReviewSession,
  incoming: Omit<Annotation, "createdAt">,
  writeBack: ShareWriteBack,
): ReviewSession {
  const existing = session.annotations.find((annotation) => annotation.id === incoming.id);

  if (existing && existing.author !== writeBack.author)
    throw new Error("cannot change another author's note");
  const stamped: Annotation = {
    ...incoming,
    author: writeBack.author,
    createdAt: existing?.createdAt ?? writeBack.now?.() ?? new Date().toISOString(),
  };
  const annotations = existing
    ? session.annotations.map((annotation) =>
        annotation.id === incoming.id ? stamped : annotation,
      )
    : [...session.annotations, stamped];

  const noted = existing
    ? { ...session, annotations }
    : withEntry(
        { ...session, annotations },
        { type: "comment", annotationId: stamped.id, createdAt: stamped.createdAt },
      );

  // Leaving a note registers the author in the participant registry, so a
  // collaborator who skipped naming resolves to anonymous, not a raw fingerprint.
  return registerParticipant(noted, writeBack.author);
}

/**
 * Remove an annotation only when it is the collaborator's own. The share
 * records the removal as an entry, so it reaches the owner and every other
 * collaborator; the note itself is shelved, never dropped.
 */
function removeOwnAnnotation(
  session: ReviewSession,
  annotationId: string,
  author: string,
  createdAt: string,
): ReviewSession {
  const existing = session.annotations.find((annotation) => annotation.id === annotationId);

  if (existing && existing.author !== author)
    throw new Error("cannot delete another author's note");
  if (!existing) return session;
  const removed: ReviewSession = {
    ...session,
    annotations: session.annotations.filter((annotation) => annotation.id !== annotationId),
    shelvedAnnotations: [...(session.shelvedAnnotations ?? []), existing],
  };

  return withEntry(removed, { type: "comment-removed", annotationId, createdAt });
}

/** Append an entry on the branch the share follows; a share without a history carries none. */
export function withEntry(session: ReviewSession, entry: NewEntry): ReviewSession {
  if (!session.history) return session;

  return { ...session, history: appendEntry(session.history, entry).history };
}

function rejectReadOnly(): Promise<never> {
  return Promise.reject(
    new Error("a shared plan takes annotations only - no plan edits or verdicts"),
  );
}
