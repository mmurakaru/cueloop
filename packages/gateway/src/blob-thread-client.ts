import type { AgentPromptRequest, AgentComment, ThreadAgentState } from "@cueloop/schema";
import type { SharedAgentRelay } from "./shared-agent";
import { unpackGatewayShare } from "./gateway-share-blob";
/** Shared viewers mutate only their own annotations; agent execution stays with the owner. */

import {
  appendEntry,
  registerParticipant,
  type Annotation,
  type NewEntry,
  type ParticipantSource,
  type Thread,
} from "@cueloop/schema";
import type { EventFrame, ThreadClient } from "@cueloop/daemon/client";
import { packSessionBlob } from "@cueloop/daemon/share-blob";
import { openBlob, sealBlob } from "./crypto";
import type { ShareChangeFeed, ShareStore } from "./store";

/** Present when the viewer may write annotations back to the store. */
export interface ShareWriteBack {
  store: ShareStore;
  masterKey: Buffer;
  shareId: string;
  author: string;
  participantName?: string;
  participantSource?: ParticipantSource;
  now?: () => string;
  changes?: ShareChangeFeed;
  agent?: SharedAgentRelay;
}

export class BlobThreadClient implements ThreadClient {
  readonly canControlAgent = false;
  private session: Thread;
  private readonly listeners = new Set<(event: EventFrame) => void>();
  private unsubscribe: (() => void) | null = null;
  private unsubscribeAgent: (() => void) | null = null;

  constructor(
    session: Thread,
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
    this.unsubscribeAgent =
      this.writeBack?.agent?.subscribe(this.writeBack.shareId, () => {
        for (const listener of this.listeners)
          listener({ event: "agent.updated", sessionId: this.session.id });
      }) ?? null;
  }

  /** Re-read the stored blob after another writer changed it, then tell the controller. */
  private async refresh(): Promise<void> {
    const writeBack = this.writeBack;

    if (!writeBack) return;

    try {
      const stored = await writeBack.store.get(writeBack.shareId);

      if (!stored) return;

      this.session = unpackGatewayShare(
        openBlob(writeBack.masterKey, writeBack.shareId, stored),
        writeBack.shareId,
      );
    } catch {
      // a torn read is retried by the next change; the current session stays
      return;
    }
    for (const listener of this.listeners) {
      listener({ event: "session.updated", sessionId: this.session.id });
    }
  }

  async sessionGet(_id: string): Promise<Thread> {
    return this.session;
  }

  async sessionList(): Promise<Thread[]> {
    return [this.session];
  }

  async sessionComment(_id: string, annotation: Omit<Annotation, "createdAt">): Promise<Thread> {
    const writeBack = this.requireWriteBack();

    return this.commit(
      writeBack,
      (session) => upsertAnnotation(session, annotation, writeBack),
      annotation.id,
    );
  }

  async sessionAnnotate(_id: string, annotation: Omit<Annotation, "createdAt">): Promise<Thread> {
    const writeBack = this.requireWriteBack();

    return this.commit(
      writeBack,
      (session) => upsertAnnotation(session, annotation, writeBack),
      annotation.id,
    );
  }

  async sessionRemoveAnnotation(_id: string, annotationId: string): Promise<Thread> {
    const writeBack = this.requireWriteBack();

    return this.commit(
      writeBack,
      (session) =>
        removeOwnAnnotation(
          session,
          annotationId,
          writeBack.author,
          writeBack.now?.() ?? new Date().toISOString(),
        ),
      annotationId,
    );
  }

  sessionSetWorkingCopy(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionCutBlock(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionRestoreBlock(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionCurate(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionSetViewed(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionSetTitle(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionNavigate(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionBranch(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionSwitch(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionLabel(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionFork(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionSetShares(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionMergeShared(): Promise<Thread> {
    return rejectReadOnly();
  }

  sessionDelete(): Promise<never> {
    return rejectReadOnly();
  }

  async sessionSetSelfName(_id: string, name: string): Promise<Thread> {
    const writeBack = this.requireWriteBack();

    return this.commit(writeBack, (session) =>
      registerParticipant(session, writeBack.author, name),
    );
  }

  sessionSendMessage(): Promise<Thread> {
    return rejectReadOnly();
  }

  private requireAgent(id: string) {
    const writeBack = this.requireWriteBack();

    if (id !== this.session.id || !writeBack.agent)
      throw new Error("Shared agent access is unavailable");

    return { relay: writeBack.agent, writeBack };
  }

  agentGet(id: string): Promise<ThreadAgentState> {
    const { relay, writeBack } = this.requireAgent(id);

    return relay.get(writeBack.shareId);
  }

  agentPrompt(params: AgentPromptRequest): Promise<ThreadAgentState> {
    const { relay, writeBack } = this.requireAgent(params.id);

    return relay.prompt(writeBack.shareId, writeBack.author, params);
  }

  agentComment(params: { id: string; comment: AgentComment }): Promise<ThreadAgentState> {
    const { relay, writeBack } = this.requireAgent(params.id);

    return relay.comment(writeBack.shareId, writeBack.author, params.comment);
  }

  agentCancel(): Promise<never> {
    return rejectReadOnly();
  }
  agentPermission(): Promise<never> {
    return rejectReadOnly();
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribeAgent?.();
    this.unsubscribe = null;
    this.listeners.clear();
  }

  private requireWriteBack(): ShareWriteBack {
    if (!this.writeBack) throw new Error("this shared plan is read-only");

    return this.writeBack;
  }

  private async commit(
    writeBack: ShareWriteBack,
    change: (session: Thread) => Thread,
    commentId?: string,
  ): Promise<Thread> {
    const commit = () => this.commitStored(writeBack, change);

    return writeBack.agent ? writeBack.agent.edit(writeBack.shareId, commentId, commit) : commit();
  }

  private async commitStored(
    writeBack: ShareWriteBack,
    change: (session: Thread) => Thread,
  ): Promise<Thread> {
    const stored = await writeBack.store.get(writeBack.shareId);
    const current = stored
      ? unpackGatewayShare(
          openBlob(writeBack.masterKey, writeBack.shareId, stored),
          writeBack.shareId,
        )
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
  session: Thread,
  incoming: Omit<Annotation, "createdAt">,
  writeBack: ShareWriteBack,
): Thread {
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

  // Leaving a note registers the author, carrying any verified github name and handle
  // so a comment persists the connected identity, not an anonymous fingerprint.
  return registerParticipant(
    noted,
    writeBack.author,
    writeBack.participantName,
    writeBack.participantSource,
  );
}

/**
 * Remove an annotation only when it is the collaborator's own. The share
 * records the removal as an entry, so it reaches the owner and every other
 * collaborator; the note itself is shelved, never dropped.
 */
function removeOwnAnnotation(
  session: Thread,
  annotationId: string,
  author: string,
  createdAt: string,
): Thread {
  const existing = session.annotations.find((annotation) => annotation.id === annotationId);

  if (existing && existing.author !== author)
    throw new Error("cannot delete another author's note");

  if (!existing) return session;

  const removed: Thread = {
    ...session,
    annotations: session.annotations.filter((annotation) => annotation.id !== annotationId),
    shelvedAnnotations: [...(session.shelvedAnnotations ?? []), existing],
  };

  return withEntry(removed, { type: "comment-removed", annotationId, createdAt });
}

/** Append an entry on the branch the share follows; a share without a history carries none. */
export function withEntry(session: Thread, entry: NewEntry): Thread {
  if (!session.history) return session;

  return { ...session, history: appendEntry(session.history, entry).history };
}

function rejectReadOnly(): Promise<never> {
  return Promise.reject(
    new Error("a shared plan takes annotations only - no plan edits or messages"),
  );
}
