/**
 * The daemon's method surface. Transport-independent: the socket
 * server and the in-process test harness both call these handlers.
 * The wait contract: messages outlive waits - session.wait long-polls,
 * and a message resolved while nobody waited is delivered on next contact.
 */

import {
  SCHEMA_VERSION,
  appendEntry,
  applyTextCuts,
  applyPathView,
  createBranch,
  cutBlock,
  feedbackForSession,
  forkHistory,
  historyFromLinear,
  HistoryError,
  labelTip,
  navigateTo,
  recaptureMainHead,
  viewOfPath,
  isAddressed,
  isAgentNote,
  annotationTarget,
  isMarkdownArtifact,
  MAIN_BRANCH,
  parseBlocks,
  registerParticipant,
  resolveAnchor,
  newMessageId,
  isBlockCut,
  restoreBlock,
  switchBranch,
  messageAllows,
  type Annotation,
  type DiffFileStatus,
  type DiffFileContents,
  type HunkRejection,
  type NewEntry,
  type Artifact,
  type ShareLink,
  type Identity,
  type HarnessBinding,
  type Delivery,
  type PendingDelivery,
  type Thread,
  type TextCut,
  type SessionHistory,
  type Message,
  type MessageOutcome,
  type WorkspaceKey,
} from "@cueloop/schema";
import { curateDiff } from "./curate";
import { ThreadStore, withHistory } from "./store";
import { pruneExpiredSessions, resolveCleanupPeriodDays } from "./retention";
import {
  HerdrThreadSurfaceStore,
  type HerdrThreadSurfaceHandle,
} from "./herdr-thread-surface-store";
import {
  GhosttyThreadSurfaceStore,
  type GhosttyThreadSurfaceHandle,
} from "./ghostty-thread-surface-store";
import { HarnessStateStore } from "./harness-state-store";
import { DiffWatcher } from "./diff-watcher";
import { PrReviewPoller } from "./pr-poller";
import { prDiff } from "./gh";
import { workingTreeDiff, workingChangeList, type WorkingTreeDiff } from "./working-tree";
import { listProjectFiles, readProjectFile } from "./project-files";
import { resolveWorkspace } from "./thread-review";
import { DaemonError } from "./errors";

/** Reviewer-controlled fields that make an annotation new or edited for delivery. */
function annotationDeliveryFingerprint(annotation: Annotation | undefined): string {
  if (!annotation) return "";

  return JSON.stringify({
    kind: annotation.kind,
    anchor: {
      quote: annotation.anchor.quote,
      prefix: annotation.anchor.prefix,
      suffix: annotation.anchor.suffix,
      blockIndex: annotation.anchor.blockIndex,
      endBlockIndex: annotation.anchor.endBlockIndex,
      start: annotation.anchor.start,
      end: annotation.anchor.end,
      selector: annotation.anchor.selector,
    },
    target: annotation.target,
    body: annotation.body,
    author: annotation.author,
    replyTo: annotation.replyTo,
  });
}

/** What a share hands back: the notes and names it collected, and the removals it recorded. */
export interface SharedMerge {
  annotations: Annotation[];
  participants?: Identity[];
  /** Removal entries by id; a merge applies each once and never rewrites what it already holds. */
  removals?: Array<{ id: string; annotationId: string; createdAt: string }>;
}

export type EventName =
  | "session.created"
  | "session.updated"
  | "message.sent"
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
  readonly store: ThreadStore;
  readonly herdrThreadSurfaces: HerdrThreadSurfaceStore;
  readonly ghosttyThreadSurfaces: GhosttyThreadSurfaceStore;
  readonly harnessState: HarnessStateStore;
  private waiters = new Map<string, ((session: Thread) => void)[]>();
  private listeners = new Set<EventListener>();
  private seq = 0;
  /** Drives diff hot-reload: watches each live diff session's repo for working-tree changes. */
  private readonly diffWatcher: DiffWatcher;
  /** Drives PR-review hot-reload: polls each open PR review for a moved head. */
  private readonly prPoller: PrReviewPoller;
  /**
   * Per-diff-session capture generation. Bumped when a refresh begins; a
   * capture whose generation is stale by the time it finishes discards its
   * result, so overlapping captures never write an older patch over a newer one.
   */
  private readonly diffRefreshGenerations = new Map<string, number>();
  /** In-flight workbench creations keyed by project, so concurrent bare launches share one thread. */
  private readonly workbenchCreation = new Map<string, Promise<Thread>>();

  constructor(home: string) {
    this.store = new ThreadStore(home);
    this.store.recover();
    this.harnessState = new HarnessStateStore(home);
    for (const session of this.store.list()) this.reconcileDeliveries(session);
    this.herdrThreadSurfaces = new HerdrThreadSurfaceStore(home);
    this.ghosttyThreadSurfaces = new GhosttyThreadSurfaceStore(home);
    const expiredThreadIds = pruneExpiredSessions(
      this.store,
      resolveCleanupPeriodDays(),
      Date.now(),
      this.harnessState.pendingThreadIds(),
    );

    for (const threadId of expiredThreadIds) {
      this.herdrThreadSurfaces.delete(threadId);
      this.ghosttyThreadSurfaces.delete(threadId);
    }
    this.diffWatcher = new DiffWatcher((repoRoot) => void this.refreshDiffsForRepo(repoRoot));
    this.prPoller = new PrReviewPoller((sessionId) => void this.sessionRefreshPrDiff(sessionId));
    // resume hot-reload for diff sessions that survived a daemon restart
    for (const session of this.store.list()) {
      this.trackLiveDiffSession(session);
    }
  }

  /** Release the watchers and pollers behind diff hot-reload; call on daemon shutdown. */
  dispose(): void {
    this.diffWatcher.close();
    this.prPoller.close();
  }

  /** The Herdr Thread surface handle, kept outside the canonical Thread. */
  herdrGetThreadSurface(sessionId: string): HerdrThreadSurfaceHandle | null {
    return this.herdrThreadSurfaces.get(sessionId);
  }

  herdrSetThreadSurface(sessionId: string, handle: HerdrThreadSurfaceHandle): void {
    this.herdrThreadSurfaces.set(sessionId, handle);
  }

  ghosttyGetThreadSurface(sessionId: string): GhosttyThreadSurfaceHandle | null {
    return this.ghosttyThreadSurfaces.get(sessionId);
  }

  ghosttySetThreadSurface(sessionId: string, handle: GhosttyThreadSurfaceHandle): void {
    this.ghosttyThreadSurfaces.set(sessionId, handle);
  }

  ghosttyClaimThreadSurface(sessionId: string): boolean {
    return this.ghosttyThreadSurfaces.claim(sessionId);
  }

  ghosttyReleaseThreadSurface(sessionId: string): void {
    this.ghosttyThreadSurfaces.release(sessionId);
  }

  harnessBind(input: {
    threadId: string;
    harness: string;
    harnessSessionId: string;
  }): HarnessBinding {
    this.sessionGet(input.threadId);
    const binding = this.harnessState.bind(input);

    this.reconcileDeliveries(this.sessionGet(input.threadId));

    return binding;
  }

  harnessGetBinding(bindingId: string): HarnessBinding {
    const binding = this.harnessState.binding(bindingId);

    if (!binding) throw new DaemonError("not_found", `no harness binding ${bindingId}`);

    return binding;
  }

  harnessBindingsForSession(harness: string, harnessSessionId: string): HarnessBinding[] {
    return this.harnessState.bindingsForSession(harness, harnessSessionId);
  }

  harnessConsumeApprovedRetry(bindingId: string, messageId: string, content: string): boolean {
    const binding = this.harnessState.binding(bindingId);

    if (!binding) throw new DaemonError("not_found", `no harness binding ${bindingId}`);
    const session = this.sessionGet(binding.threadId);

    if (
      session.artifact.type !== "plan" ||
      session.status !== "resolved" ||
      session.message?.id !== messageId ||
      session.message.outcome !== "approved" ||
      session.artifact.content !== content ||
      this.harnessState.submittingBinding(session.id)?.id !== bindingId ||
      !this.harnessState.acknowledged(bindingId, messageId)
    ) {
      throw new DaemonError("invalid_state", `no unchanged approved plan for ${bindingId}`);
    }

    return this.harnessState.consumeApprovedRetry(bindingId, messageId);
  }

  deliveryPending(bindingId: string): PendingDelivery[] {
    const binding = this.harnessState.binding(bindingId);

    if (!binding) throw new DaemonError("not_found", `no harness binding ${bindingId}`);
    const session = this.sessionGet(binding.threadId);

    return this.harnessState.pending(bindingId).map((delivery) => {
      const historical = session.history?.entries.find(
        (entry) => entry.type === "message" && entry.message.id === delivery.messageId,
      );
      const message =
        session.message?.id === delivery.messageId
          ? session.message
          : historical?.type === "message"
            ? historical.message
            : null;

      if (!message || message.id !== delivery.messageId) {
        throw new DaemonError("not_found", `no message ${delivery.messageId}`);
      }

      return { delivery, message };
    });
  }

  deliveryAcknowledge(deliveryId: string): Delivery {
    if (!this.harnessState.delivery(deliveryId)) {
      throw new DaemonError("not_found", `no delivery ${deliveryId}`);
    }

    return this.harnessState.acknowledge(deliveryId);
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

  /** True when nothing awaits a message - drives idle-exit. */
  hasPendingSessions(): boolean {
    return this.store.list().some((session) => session.status === "pending");
  }

  sessionCreate(params: { workspace: WorkspaceKey; artifact: Artifact }): Thread {
    const now = new Date().toISOString();
    const session: Thread = {
      schemaVersion: SCHEMA_VERSION,
      id: this.newSessionId(now),
      workspace: params.workspace,
      artifact: params.artifact,
      revisions: [{ revision: 1, content: params.artifact.content, submittedAt: now }],
      annotations: [],
      message: null,
      status: "pending",
      createdAt: now,
    };

    session.history = historyFromLinear(session);
    this.store.upsert(session);
    this.reconcileDeliveries(session);
    this.trackLiveDiffSession(session);
    this.emit("session.created", session.id);
    this.emit("inbox.changed", session.id);

    return session;
  }

  private reconcileDeliveries(session: Thread): void {
    if (!session.message) return;

    const binding = this.harnessState.submittingBinding(session.id);

    if (binding)
      this.harnessState.enqueue({ bindingId: binding.id, messageId: session.message.id });
  }

  private newSessionId(now: string): string {
    return `ses_${now.replace(/\D/g, "").slice(0, 14)}_${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  sessionGet(id: string): Thread {
    const session = this.store.get(id);

    if (!session) throw new DaemonError("not_found", `no session ${id}`);

    return session;
  }

  sessionList(filter?: {
    status?: "pending" | "resolved";
    workspace?: Partial<WorkspaceKey>;
  }): Thread[] {
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
   * Long-poll for the message. Resolves immediately when already resolved;
   * otherwise parks until sessionSendMessage fires or timeoutMs elapses (null =
   * still pending - the caller re-polls later; the message is never lost).
   */
  sessionWait(id: string, timeoutMs: number): Promise<Thread | null> {
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
      const waiter = (session: Thread) => {
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
  ): Thread {
    const session = this.mutable(id);
    // a welcome-playground note is ephemeral by design: never persisted, so never fed back
    if (annotationTarget(annotation).kind === "welcome") return session;
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
  sessionRemoveAnnotation(id: string, annotationId: string, onBehalfOf?: string): Thread {
    const session = this.mutable(id);
    const target = session.annotations.find((candidate) => candidate.id === annotationId);

    if (onBehalfOf !== undefined && target !== undefined && target.author !== onBehalfOf) {
      throw new DaemonError("forbidden", `${onBehalfOf} cannot remove another author's comment`);
    }
    session.annotations = session.annotations.filter((candidate) => candidate.id !== annotationId);
    let entryId: string | undefined;

    if (target !== undefined) {
      // nothing is deleted: a navigate back before the removal shows it again
      session.shelvedAnnotations = [...(session.shelvedAnnotations ?? []), target];
      entryId = this.record(session, {
        type: "comment-removed",
        annotationId,
        createdAt: new Date().toISOString(),
      });
    }

    this.store.upsert(session);
    this.emit("session.updated", id, entryId);

    return session;
  }

  /** Register a display name for a participant; how a collaborator or an agent names itself. */
  sessionSetParticipantName(id: string, author: string, name: string): Thread {
    const session = this.mutable(id);

    session.participants = registerParticipant(session, author, name).participants;
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  /** The reviewer's working copy; undefined clears it (revert all edits). */
  sessionSetWorkingCopy(id: string, workingCopy: string | undefined, textCuts?: TextCut[]): Thread {
    const session = this.mutable(id);

    if (textCuts?.length) this.assertTextCuts(session.artifact.content, workingCopy, textCuts);
    const entryId = this.applyWorkingCopy(session, workingCopy, textCuts);

    this.store.upsert(session);
    this.emit("session.updated", id, entryId);

    return session;
  }

  private assertTextCuts(
    source: string,
    workingCopy: string | undefined,
    textCuts: readonly TextCut[],
  ): void {
    let previousEnd = 0;
    const valid = textCuts.every((cut) => {
      const matches =
        cut.start >= previousEnd &&
        cut.end > cut.start &&
        cut.end <= source.length &&
        source.slice(cut.start, cut.end) === cut.quote;

      previousEnd = cut.end;

      return matches;
    });

    if (!valid || workingCopy === undefined || applyTextCuts(source, textCuts) !== workingCopy) {
      throw new DaemonError(
        "invalid_params",
        "text Cuts do not match the submitted artifact and working copy",
      );
    }
  }

  /**
   * The guided walk's viewed marks. Merge-additive: walking only ever adds
   * marks, so concurrent or stale clients converge instead of overwriting
   * each other. An empty array is the explicit reset.
   */
  sessionSetViewed(id: string, viewedPaths: string[]): Thread {
    const session = this.mutable(id);

    if (viewedPaths.length === 0) delete session.viewedPaths;
    else session.viewedPaths = [...new Set([...(session.viewedPaths ?? []), ...viewedPaths])];
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  /** Rename a session's display title; an empty title clears it back to the derived default. */
  sessionSetTitle(id: string, title: string): Thread {
    const session = this.mutable(id);
    const trimmed = title.trim();

    if (trimmed.length === 0) delete session.artifact.meta.title;
    else session.artifact.meta.title = trimmed;
    this.store.upsert(session);
    // the title shows in the Threads sidebar, so a rename is an inbox change, not just a content edit
    this.emit("inbox.changed", id);

    return session;
  }

  /** Tracked, repo-relative file paths for the session's workspace; [] when it has no repo. */
  projectFiles(id: string): Promise<string[]> {
    return listProjectFiles(this.sessionGet(id).workspace.repoRoot);
  }

  /** UTF-8 contents of a repo-relative file in the session's workspace, or null when it cannot be read safely. */
  fileContents(id: string, path: string): Promise<string | null> {
    return readProjectFile(this.sessionGet(id).workspace.repoRoot, path);
  }

  /** Tracked, repo-relative file paths for the git repo containing `cwd`; [] when it is not a repo. Owner-only. */
  async repoFiles(cwd: string): Promise<string[]> {
    return listProjectFiles((await resolveWorkspace(cwd)).repoRoot);
  }

  /** UTF-8 contents of a repo-relative file in the repo containing `cwd`, or null when unreadable. Owner-only. */
  async repoFileContents(cwd: string, path: string): Promise<string | null> {
    return readProjectFile((await resolveWorkspace(cwd)).repoRoot, path);
  }

  /** Changed files (repo-relative path plus git status) in the working tree at `cwd`. Owner-only. */
  repoChanges(cwd: string): Promise<{ path: string; status: DiffFileStatus }[]> {
    return workingChangeList(cwd);
  }

  /**
   * The live working-tree diff (HEAD vs working tree, untracked included) at `cwd`:
   * the same unified patch plus full per-file contents a `cueloop diff` captures,
   * so the Changes navigator renders a real diff for any thread. Owner-only.
   */
  repoDiff(cwd: string): Promise<WorkingTreeDiff> {
    return workingTreeDiff(cwd);
  }

  /**
   * The per-repo workbench thread for `cwd`: a self-initiated review of the current checkout, keyed by
   * the repo's root-commit identity (a standalone bucket when there is none). Returns the existing one
   * or lazily creates it with the working-tree diff as its artifact, so a bare launch persists its
   * first comment without an agent submission. Owner-only.
   */
  async workbenchSession(cwd: string): Promise<Thread> {
    const workspace = await resolveWorkspace(cwd);
    const key = workspace.rootCommit ?? "_standalone";
    // an open workbench is reused; a resolved one is immutable and would reject the note, so a fresh
    // one is created past it
    const open = this.store
      .list()
      .find(
        (session) =>
          session.artifact.meta.workbench === true &&
          session.status !== "resolved" &&
          (session.workspace.rootCommit ?? "_standalone") === key,
      );

    if (open) return open;
    // serialize concurrent bare launches for the same repo onto one creation, so they share a thread
    const inFlight = this.workbenchCreation.get(key);

    if (inFlight) return inFlight;
    const creation = workingTreeDiff(cwd).then((diff) =>
      this.sessionCreate({
        workspace,
        artifact: {
          type: "diff",
          content: diff.patch,
          files: diff.files,
          meta: { workbench: true, title: "Workbench", cwd },
        },
      }),
    );

    this.workbenchCreation.set(key, creation);
    try {
      return await creation;
    } finally {
      this.workbenchCreation.delete(key);
    }
  }

  sessionSetShareId(id: string, shareId: string): Thread {
    const session = this.mutable(id);

    session.shareId = shareId;
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  /** Replace the thread's share links; the legacy single-share fields are dropped once shares[] is authoritative. */
  sessionSetShares(id: string, shares: ShareLink[]): Thread {
    const session = this.mutable(id);

    session.shares = shares;
    delete session.shareId;
    delete session.access;
    delete session.owner;
    delete session.shareBranch;
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  /** Set the private-share allowlist of GitHub logins; presence marks the share private. */
  sessionSetAccess(id: string, githubLogins: string[]): Thread {
    const session = this.mutable(id);

    session.access = { githubLogins };
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  /** Remove a session for good (inbox delete); resolved or pending, both go. */
  sessionDelete(id: string): void {
    const session = this.store.get(id);

    if (!this.store.delete(id)) throw new DaemonError("not_found", `no session ${id}`);
    if (session) this.untrackLiveDiffSession(session);
    this.diffRefreshGenerations.delete(id);
    this.herdrThreadSurfaces.delete(id);
    this.ghosttyThreadSurfaces.delete(id);
    this.emit("inbox.changed", id);
  }

  /**
   * Cut one block of the reviewer's working copy - the `blockIndex`-th block
   * of the working text - so it serializes into the diff the agent receives.
   */
  sessionCutBlock(id: string, blockIndex: number): Thread {
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
  sessionRestoreBlock(id: string, baseBlockIndex: number, line?: number): Thread {
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

    if (!isBlockCut(base, working, block)) {
      throw new DaemonError(
        "invalid_params",
        `block ${baseBlockIndex} of the submitted revision is present in the working copy`,
      );
    }
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
  sessionCurate(id: string, rejections: HunkRejection[]): Thread {
    const session = this.mutable(id);

    if (session.artifact.type !== "diff") {
      throw new DaemonError("invalid_params", "only a diff review is curated by hunk");
    }
    if (!session.artifact.files?.length) {
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
   * Merge a share's state back into the local session. Comments union by
   * annotation id with existing ones (the planner's) winning; removals union by
   * entry id, each shelving its comment once; the participant registry unions
   * by id with the incoming identity winning (a collaborator is the authority
   * on their own name). Everything lands on the branch the share follows, and
   * the record then shows its current path again, wherever the owner stands.
   */
  sessionMergeShared(id: string, incoming: SharedMerge): Thread {
    const session = this.mutable(id);
    const branch = this.shareBranchOf(session);
    const known = new Set(
      [...session.annotations, ...(session.shelvedAnnotations ?? [])].map(
        (annotation) => annotation.id,
      ),
    );
    let changed = false;

    for (const annotation of incoming.annotations) {
      if (known.has(annotation.id)) continue;
      known.add(annotation.id);
      session.annotations.push(annotation);
      this.recordOn(session, branch, {
        type: "comment",
        annotationId: annotation.id,
        createdAt: annotation.createdAt,
      });
      changed = true;
    }
    const recorded = new Set((session.history?.entries ?? []).map((entry) => entry.id));

    for (const removal of incoming.removals ?? []) {
      if (recorded.has(removal.id) || !known.has(removal.annotationId)) continue;
      this.recordOn(session, branch, {
        id: removal.id,
        type: "comment-removed",
        annotationId: removal.annotationId,
        createdAt: removal.createdAt,
      });
      changed = true;
    }
    if (incoming.participants?.length) {
      const registry = new Map(
        (session.participants ?? []).map((participant) => [participant.id, participant]),
      );

      for (const participant of incoming.participants) registry.set(participant.id, participant);
      session.participants = [...registry.values()];
    }
    if (changed && session.history) this.refreshView(session, session.history);
    else this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  sessionSendMessage(
    id: string,
    outcome: MessageOutcome,
    summary: string,
    actionBodies?: Record<string, string>,
  ): Thread {
    const session = this.mutable(id);
    const sentAt = new Date().toISOString();
    const sentAnnotations = new Map(
      (session.history?.entries ?? [])
        .filter((entry) => entry.type === "message")
        .flatMap((entry) => (entry.type === "message" ? (entry.message.annotations ?? []) : []))
        .map((annotation) => [annotation.id, annotation]),
    );
    const annotations = session.annotations.filter(
      (annotation) =>
        !isAddressed(annotation) &&
        annotationDeliveryFingerprint(sentAnnotations.get(annotation.id)) !==
          annotationDeliveryFingerprint(annotation),
    );
    const message: Message = {
      id: newMessageId(),
      outcome,
      summary,
      body: feedbackForSession(session, outcome, summary, actionBodies, annotations),
      annotations,
      sentAt,
    };

    session.message = message;
    session.status = outcome === "comment" ? "pending" : "resolved";
    const entryId = this.record(session, {
      type: "message",
      message,
      createdAt: message.sentAt,
    });
    this.store.upsert(session);
    this.reconcileDeliveries(session);
    this.emit("message.sent", id, entryId);
    if (outcome === "comment") {
      this.emit("session.updated", id, entryId);

      return session;
    }
    // a resolved diff review is frozen; stop hot-reloading its working tree
    this.untrackLiveDiffSession(session);
    const parked = this.waiters.get(id) ?? [];

    this.waiters.delete(id);
    for (const parkedWaiter of parked) parkedWaiter(session);
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
    files?: DiffFileContents[],
  ): Thread {
    const session = this.sessionGet(id);
    const now = new Date().toISOString();
    const revisionNumber = session.revisions.length + 1;

    session.revisions.push({ revision: revisionNumber, content, submittedAt: now });
    session.artifact = { ...session.artifact, content, files: files ?? session.artifact.files };
    // the agent's revision lands on main wherever its tip sits; the artifact
    // shows the head of the branch the reviewer is on
    const entryId = this.recordOnMain(session, {
      type: "revision",
      by: "agent",
      content,
      createdAt: now,
    });
    delete session.workingCopy;
    delete session.textCuts;
    session.message = null;
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
        // only a note on the artifact drifts against the artifact's revision; a selector-anchored
        // pixel element or a file-targeted Changes-diff note anchors elsewhere
        annotationTarget(annotation).kind === "artifact" &&
        !annotation.anchor.selector &&
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

  /**
   * Move a branch's tip back to an entry on its path - the current branch, or
   * `branch` after switching to it. The entries after it stay in the tree; a
   * summary records them as a branch-summary entry at the target. The view
   * follows the path: on `main`, the agent's next revision lands there.
   */
  sessionNavigate(id: string, entryId: string, summary?: string, branch?: string): Thread {
    const session = this.mutable(id);
    const moved = this.tree(id, () => {
      const history = this.historyOf(session);
      const standing = branch === undefined ? history : switchBranch(history, branch);

      return navigateTo(standing, entryId, summary === undefined ? {} : { summary });
    });

    this.refreshView(session, moved);
    const tip = moved.tips[moved.branch];

    this.emit("session.updated", id, tip === entryId ? undefined : tip);

    return session;
  }

  /** Start a branch at the current tip and switch to it; `main` stays where it is. */
  sessionBranch(id: string, name: string): Thread {
    const session = this.mutable(id);

    this.refreshView(
      session,
      this.tree(id, () => createBranch(this.historyOf(session), name)),
    );
    this.emit("session.updated", id);

    return session;
  }

  sessionSwitch(id: string, branch: string): Thread {
    const session = this.mutable(id);

    this.refreshView(
      session,
      this.tree(id, () => switchBranch(this.historyOf(session), branch)),
    );
    this.emit("session.updated", id);

    return session;
  }

  /** Name the current tip as a checkpoint to navigate back to. */
  sessionLabel(id: string, label: string): Thread {
    const session = this.mutable(id);

    session.history = labelTip(this.historyOf(session), label);
    this.store.upsert(session);
    this.emit("session.updated", id);

    return session;
  }

  /**
   * Copy the current path into a new pending session: its revisions, open
   * comments, labels, and participant names travel; messages, edits, and the
   * share do not. A resolved session can be forked.
   */
  sessionFork(id: string): Thread {
    const source = this.sessionGet(id);
    const history = this.tree(id, () => forkHistory(this.historyOf(source)));
    const now = new Date().toISOString();
    const known = [...source.annotations, ...(source.shelvedAnnotations ?? [])];
    const view = viewOfPath(history, known);
    const fork: Thread = {
      schemaVersion: SCHEMA_VERSION,
      id: this.newSessionId(now),
      workspace: source.workspace,
      artifact: { ...source.artifact, content: view.content },
      revisions: history.entries
        .filter((entry) => entry.type === "revision")
        .map((entry, index) => ({
          revision: index + 1,
          content: entry.content,
          submittedAt: entry.createdAt,
        })),
      annotations: [],
      history,
      message: null,
      status: "pending",
      createdAt: now,
      parentSessionId: id,
    };

    fork.annotations = view.annotations.map((annotation) =>
      forkedAnnotation(annotation, source, fork),
    );
    if (source.participants)
      fork.participants = source.participants.map((identity) => ({ ...identity }));
    this.store.upsert(fork);
    this.trackLiveDiffSession(fork);
    this.emit("session.created", fork.id);
    this.emit("inbox.changed", fork.id);

    return fork;
  }

  /** Re-capture a diff session's working tree; broadcasts session.updated only when the patch moved. */
  async sessionRefreshDiff(id: string): Promise<{ changed: boolean }> {
    const session = this.mutable(id);

    if (session.artifact.type !== "diff") return { changed: false };
    // a PR review has no local working tree; re-pull it from the PR instead of clobbering it
    if (session.artifact.meta.pr !== undefined) return this.sessionRefreshPrDiff(id);
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
    // the history keeps showing the same revision, re-captured, so a later tree move derives this patch
    const history = withHistory(current).history;

    if (history) current.history = recaptureMainHead(history, diff.patch);
    this.store.upsert(current);
    this.emit("session.updated", id);

    return { changed: true };
  }

  /**
   * Re-pull a PR review's diff when its head moved; broadcasts session.updated
   * only when the patch text changed. A PR review has no local working tree, so
   * it never runs workingTreeDiff - the diff comes from gh.
   */
  async sessionRefreshPrDiff(id: string): Promise<{ changed: boolean }> {
    const session = this.store.get(id);

    if (!session || session.status !== "pending" || session.artifact.type !== "diff")
      return { changed: false };
    const pr = session.artifact.meta.pr;

    if (pr === undefined) return { changed: false };
    const generation = (this.diffRefreshGenerations.get(id) ?? 0) + 1;

    this.diffRefreshGenerations.set(id, generation);
    const patch = await prDiff(pr);

    // gh failed (offline, unauthenticated): keep the diff we have, try again next poll
    if (patch === null) return { changed: false };
    // the pull yields the event loop: discard a stale capture or a closed session
    if (this.diffRefreshGenerations.get(id) !== generation) return { changed: false };
    const current = this.store.get(id);

    if (!current || current.status !== "pending" || current.artifact.type !== "diff")
      return { changed: false };
    if (patch === current.artifact.content) return { changed: false };
    current.artifact = { ...current.artifact, content: patch };
    const history = withHistory(current).history;

    if (history) current.history = recaptureMainHead(history, patch);
    this.store.upsert(current);
    this.emit("session.updated", id);

    return { changed: true };
  }

  /** Re-capture every working-tree diff session sharing a repo root (one debounced fs change). */
  private async refreshDiffsForRepo(repoRoot: string): Promise<void> {
    const live = this.store
      .list()
      .filter(
        (session) => isWorkingTreeDiffSession(session) && session.workspace.repoRoot === repoRoot,
      );

    for (const session of live) {
      // a session resolved or deleted between the change and this tick just skips
      try {
        await this.sessionRefreshDiff(session.id);
      } catch {
        // no-op: the session is gone or already resolved
      }
    }
  }

  private trackLiveDiffSession(session: Thread): void {
    if (isWorkingTreeDiffSession(session))
      this.diffWatcher.trackDiffRepo(session.workspace.repoRoot, session.id);
    else if (isPrReviewSession(session))
      this.prPoller.trackPr(session.id, session.artifact.meta.pr!);
  }

  private untrackLiveDiffSession(session: Thread): void {
    if (session.artifact.type !== "diff") return;
    this.diffWatcher.untrackDiffRepo(session.workspace.repoRoot, session.id);
    this.prPoller.untrackPr(session.id);
  }

  /**
   * Set or clear the working copy and, when the reviewer's text changed, record
   * it as a reviewer revision on the current branch. Returns that entry's id.
   */
  private applyWorkingCopy(
    session: Thread,
    workingCopy: string | undefined,
    textCuts?: TextCut[],
  ): string | undefined {
    const before = session.workingCopy ?? session.artifact.content;
    const next =
      workingCopy === undefined || workingCopy === session.artifact.content
        ? undefined
        : workingCopy;

    if (textCuts?.length) session.textCuts = textCuts;
    else delete session.textCuts;
    if (next === undefined) delete session.workingCopy;
    else session.workingCopy = next;
    const after = next ?? session.artifact.content;

    if (after === before) return undefined;

    const revision: Extract<NewEntry, { type: "revision" }> = {
      type: "revision",
      by: "reviewer",
      content: after,
      createdAt: new Date().toISOString(),
    };

    if (textCuts?.length) revision.textCuts = textCuts;

    return this.record(session, revision);
  }

  /** The session's history; a record without a revision has none and cannot be moved through. */
  private historyOf(session: Thread): SessionHistory {
    const history = withHistory(session).history;

    if (!history) throw new DaemonError("invalid_params", `session ${session.id} has no history`);

    return history;
  }

  /** Run a tree operation; a refused move is the caller's mistake, not the daemon's. */
  private tree(id: string, operation: () => SessionHistory): SessionHistory {
    try {
      return operation();
    } catch (error) {
      if (error instanceof HistoryError) throw new DaemonError("invalid_params", error.message);
      throw error;
    }
  }

  /** Store a moved history and make the record show its active path. */
  private refreshView(session: Thread, history: SessionHistory): void {
    session.history = history;
    applyPathView(
      session,
      viewOfPath(history, [...session.annotations, ...(session.shelvedAnnotations ?? [])]),
    );
    this.store.upsert(session);
  }

  /** Append an entry on the session's current branch; a session without a head has no history to extend. */
  private record(session: Thread, entry: NewEntry): string | undefined {
    const history = withHistory(session).history;

    if (!history) return undefined;
    const appended = appendEntry(history, entry);

    session.history = appended.history;

    return appended.entry.id;
  }

  /** Append an entry on main, leaving the reviewer's current branch where it is. */
  private recordOnMain(session: Thread, entry: NewEntry): string | undefined {
    return this.recordOn(session, MAIN_BRANCH, entry);
  }

  /** Append an entry on a named branch, leaving the reviewer's current branch where it is. */
  private recordOn(session: Thread, branch: string, entry: NewEntry): string | undefined {
    const history = withHistory(session).history;

    if (!history) return undefined;
    const appended = appendEntry(switchBranch(history, branch), entry);

    session.history = { ...appended.history, branch: history.branch };

    return appended.entry.id;
  }

  /** The branch a share follows; a share made before branches existed follows main. */
  private shareBranchOf(session: Thread): string {
    const branch = session.shareBranch ?? MAIN_BRANCH;

    return session.history?.tips[branch] === undefined ? MAIN_BRANCH : branch;
  }

  private mutable(id: string): Thread {
    const session = this.sessionGet(id);

    if (session.status === "resolved")
      throw new DaemonError("resolved", `session ${id} is already resolved`);

    return session;
  }
}

export { DaemonError };

/**
 * A comment as the fork carries it. An addressed mark names a revision by the
 * source's numbering; the fork numbers its own, so the mark follows the
 * revision's text, and a comment addressed by a revision off the fork's path
 * is open again.
 */
function forkedAnnotation(annotation: Annotation, source: Thread, fork: Thread): Annotation {
  const { resolution, ...open } = annotation;

  if (resolution === undefined) return { ...annotation };
  const addressedBy = source.revisions.find(
    (revision) => revision.revision === resolution.revision,
  );
  const inFork = fork.revisions.find((revision) => revision.content === addressedBy?.content);

  return inFork === undefined
    ? open
    : { ...annotation, resolution: { ...resolution, revision: inFork.revision } };
}

/** A pending diff of the local working tree: hot-reloads by watching its repo. A PR review is excluded. */
function isWorkingTreeDiffSession(session: Thread): boolean {
  return (
    session.status === "pending" &&
    session.artifact.type === "diff" &&
    session.artifact.meta.pr === undefined
  );
}

/** A pending review of a remote PR: hot-reloads by polling the PR head, never by watching a working tree. */
function isPrReviewSession(session: Thread): boolean {
  return (
    session.status === "pending" &&
    session.artifact.type === "diff" &&
    session.artifact.meta.pr !== undefined
  );
}

/** Convenience for adapters: map a resolved session to the agent contract. */
export function messageResponse(session: Thread) {
  if (!session.message) throw new DaemonError("pending", "session has no message");

  return { allow: messageAllows(session.message.outcome), message: session.message };
}
