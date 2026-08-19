/**
 * The review-session controller: every daemon round-trip and mutation
 * verb behind one React-free object. It owns connect/autostart/subscribe,
 * the session/inbox/status/error snapshot, optimistic apply, the mutation
 * verbs (cut/edit/annotate/submit/...), and the post-submit completion
 * lifecycle including the notes-vault export and the herdr return-focus.
 * App subscribes to snapshots and keeps only view state.
 */

import { SystemClock, type Clock, type TimerHandle } from "@opentui/core";
import { DaemonClient, type SessionClient } from "@cueloop/daemon/client";
import {
  cutBlock,
  detectHerdr,
  makeAnchor,
  newAnnotationId,
  parseBlocks,
  resolveAnchor,
  restoreBlock,
  restoreLine,
  returnPaneFor,
  type Annotation,
  type ReviewSession,
  type VerdictKind,
} from "@cueloop/schema";
import { loadBundledExporters, type BundledExporter } from "./integrations";
import {
  collaboratorAnnotations,
  publishShare,
  pullShare,
  pushShare,
  shareIdFromLine,
} from "./share";
import { buildDisplay, nextWorkBlock, type DisplayBlock } from "./view-plan";
import { diffRowAnchor, diffRows, type DiffRow } from "./view-diff";
import {
  changeRejectionForRow,
  curateDiff,
  hunkRejectionForRow,
  isRowRejected,
  parseFileDiff,
  sameRejection,
  type HunkRejection,
} from "./diff-hunk-curate";
import type { FileDiffMetadata } from "@pierre/diffs";
import { firstUnviewedIndex, walkFiles, type WalkFile } from "./walk";
import { editInEditor } from "./editor";
import { focusHerdrPane } from "./herdr";
import {
  persistAutoClose,
  persistReviewState,
  persistReviewWidth,
  type AutoClose,
  type CueloopConfig,
} from "./config";
import type { ReviewPanelMode } from "./review-panel";

/**
 * Post-submit lifecycle (a review pane should hand you back to the agent,
 * not linger): idle → counting (a visible countdown, the default) → exit.
 * esc dismisses to the resolved view; a remembers the countdown as default.
 */
export type Completion =
  | { phase: "idle" }
  | { phase: "prompt" }
  | { phase: "counting"; remaining: number }
  | { phase: "dismissed" };

/** Seconds the completion overlay counts down before it hands back. */
export const DEFAULT_AUTO_CLOSE = 5;

/** How often an open shared plan re-pulls collaborator notes (ADR 0005 stage 2). */
export const SHARE_POLL_MS = 4000;

/** Shared empty set so "nothing rejected" is a stable identity for renders. */
const EMPTY_REJECTED_ROWS: Set<number> = new Set();

export interface ToastState {
  title?: string;
  body: string;
}

export interface ControllerSnapshot {
  session: ReviewSession | null;
  inbox: ReviewSession[] | null;
  status: string;
  toast: ToastState | null;
  error: string | null;
  completion: Completion;
  /**
   * Annotations whose anchor stopped resolving after the last editor
   * hand-off - the reconciliation banner count. 0 = no banner.
   */
  editOrphanCount: number;
  /**
   * The guided walk's cursor (diff sessions): which wizard step is on
   * screen. index === file count is the end card. null = not walking; the
   * viewed set itself rides the session record, so leaving loses nothing.
   */
  walk: { index: number } | null;
}

export interface ReviewControllerOptions {
  home?: string;
  sessionId?: string;
  /** Observer mode: stored for the key reducer's read-only gate. */
  readOnly?: boolean;
  onExit?: (code: number) => void;
  /** Timer source for the auto-close countdown; tests inject a ManualClock. */
  clock?: Clock;
  /**
   * How the controller gets its session client. Defaults to dialing the local
   * daemon; the sharing gateway injects a blob-backed client so the same <App>
   * renders a decrypted share instead.
   */
  openClient?: () => Promise<SessionClient>;
}

export interface ReviewController {
  readonly readOnly: boolean;
  /** Snapshot listeners (stable identity - safe for useSyncExternalStore). */
  subscribe(listener: () => void): () => void;
  getSnapshot(): ControllerSnapshot;
  /** Dial the daemon (autostart), subscribe to events, fetch session or inbox. */
  connect(): void;
  close(): void;
  /** Loaded config parts the controller acts on: auto-close and exporters. */
  applyConfig(config: CueloopConfig): void;
  setStatus(message: string): void;
  showToast(body: string, title?: string): void;
  dismissToast(): void;
  /** Derived projections, cached per session identity. */
  display(): DisplayBlock[];
  rows(): DiffRow[];
  /** The walk's step list, derived from the diff rows. */
  files(): WalkFile[];
  working(): string;
  /** Open a session from the inbox. */
  open(id: string): void;
  /** Delete a session for good (inbox delete); the inbox refreshes on the event. */
  deleteSession(id: string): void;
  /** Record the viewer's own name into the share's participant registry (collaborator self-naming). */
  setSelfName(name: string): void;
  /** Cut the block under the cursor, or restore a cut one. */
  cut(displayIndex: number): void;
  /** Toggle rejection of the whole hunk under the diff cursor (owner curation). */
  toggleRejectHunk(rowIndex: number): void;
  /** Toggle rejection of the single change under the diff cursor (owner curation). */
  toggleRejectChange(rowIndex: number): void;
  /** Rendered row indices dropped by the current reject decisions (for dimming). */
  rejectedRows(): Set<number>;
  /** The $EDITOR hand-off on the working copy. */
  edit(): void;
  /**
   * Anchor and store an annotation; both plan and diff anchor constructions.
   * Returns the minted annotation id so the view can select the new card.
   */
  annotate(
    kind: "comment" | "suggestion",
    displayIndex: number,
    start: number,
    end: number,
    body: string,
  ): string | undefined;
  /** Rewrite a stored annotation's body in place (the rail-card edit). */
  updateAnnotation(id: string, body: string): void;
  removeAnnotation(id: string): void;
  setWorkingCopy(content: string | undefined): void;
  /** Enter the guided walk at the first unviewed file (diff sessions). */
  walkStart(): void;
  /** Mark the current file viewed (persists with the session) and advance. */
  walkForward(): void;
  walkBack(): void;
  /** Leave the walk; the viewed set stays on the session record. */
  walkLeave(): void;
  /** Resolve the review, run the export, start the completion hand-back. */
  submit(verdict: VerdictKind, summary: string): void;
  /** Publish the current session as a share; the ssh line lands on the clipboard. */
  share(): void;
  /** Pull a shared plan's collaborator notes back and union them in (planner only). */
  pullShared(): Promise<void>;
  /** Poll the share for collaborator notes while it is open; returns a stop handle. */
  startSharePoll(): () => void;
  /** Close the review and, inside herdr, bounce focus back to the agent. */
  finishReview(): void;
  dismissCompletion(): void;
  /** From the completion prompt: persist auto-close and start the countdown. */
  optInAutoClose(): void;
  /**
   * Persist the review-panel layout (client view state) to the user config so
   * the collapse mode and rail width survive a restart. A read-only config dir
   * never blocks the review.
   */
  saveReviewPanel(layout: { mode?: ReviewPanelMode; width?: number }): void;
}

export function createReviewController(options: ReviewControllerOptions): ReviewController {
  return new Controller(options);
}

class Controller implements ReviewController {
  readonly readOnly: boolean;
  private client: SessionClient | null = null;
  private closed = false;
  private snapshot: ControllerSnapshot = {
    session: null,
    inbox: null,
    status: "",
    toast: null,
    error: null,
    completion: { phase: "idle" },
    editOrphanCount: 0,
    walk: null,
  };
  private listeners = new Set<() => void>();
  private autoClose: AutoClose = "off";
  private editor: string | undefined;
  private exporters: BundledExporter[] = [];
  private readonly clock: Clock;
  private countdown: TimerHandle | undefined;
  private sharePoll: TimerHandle | undefined;
  private shareRun: object | null = null;
  /** Projections keyed by session identity so renders reuse one computation. */
  private derivedFor: ReviewSession | null = null;
  private derived: {
    display: DisplayBlock[];
    rows: DiffRow[];
    files: WalkFile[];
    /** Per-path parsed diff models, for hunk curation; empty when files absent. */
    models: Map<string, FileDiffMetadata>;
  } = {
    display: [],
    rows: [],
    files: [],
    models: new Map(),
  };
  /** The owner's per-hunk/change reject decisions for the open diff session. */
  private rejections: HunkRejection[] = [];

  constructor(private readonly options: ReviewControllerOptions) {
    this.readOnly = options.readOnly ?? false;
    this.clock = options.clock ?? new SystemClock();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ControllerSnapshot => this.snapshot;

  private update(patch: Partial<ControllerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  connect(): void {
    void (async () => {
      try {
        const openClient =
          this.options.openClient ??
          (() => DaemonClient.connect({ home: this.options.home, autostart: true }));
        const client = await openClient();
        if (this.closed) return void client.close();
        this.client = client;
        client.onEvent((event) => {
          // another controller/observer changed state: re-fetch
          const session = this.snapshot.session;
          if (session && event.sessionId === session.id) void this.refreshSession(session.id);
          if (!this.options.sessionId) void this.refreshInbox();
        });
        await client.subscribe();
        if (this.options.sessionId) {
          this.update({ session: await client.sessionGet(this.options.sessionId) });
        } else {
          this.update({ inbox: await client.sessionList({ status: "pending" }) });
        }
      } catch (err) {
        this.update({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }

  close(): void {
    this.closed = true;
    this.clearCountdown();
    this.stopSharePoll();
    this.client?.close();
  }

  private clearCountdown(): void {
    if (this.countdown !== undefined) this.clock.clearTimeout(this.countdown);
    this.countdown = undefined;
  }

  applyConfig(config: CueloopConfig): void {
    this.autoClose = config.ui.autoClose;
    this.editor = config.ui.editor;
    void loadBundledExporters(config.integrations).then((exporters) => {
      this.exporters = exporters;
    });
  }

  setStatus(message: string): void {
    this.update({ status: message });
  }

  showToast(body: string, title?: string): void {
    this.update({ toast: { body, title } });
  }

  dismissToast(): void {
    if (this.snapshot.toast) this.update({ toast: null });
  }

  // ── derived projections ─────────────────────
  private ensureDerived(): void {
    const session = this.snapshot.session;
    if (this.derivedFor === session) return;
    this.derivedFor = session;
    const rows =
      session && session.artifact.type === "diff" ? diffRows(session.artifact.content) : [];
    const models = new Map<string, FileDiffMetadata>();
    for (const file of session?.artifact.files ?? []) models.set(file.path, parseFileDiff(file));
    this.derived = {
      display: session ? buildDisplay(session.artifact.content, session.workingCopy) : [],
      rows,
      files: walkFiles(rows),
      models,
    };
  }

  display(): DisplayBlock[] {
    this.ensureDerived();
    return this.derived.display;
  }

  rows(): DiffRow[] {
    this.ensureDerived();
    return this.derived.rows;
  }

  files(): WalkFile[] {
    this.ensureDerived();
    return this.derived.files;
  }

  working(): string {
    const session = this.snapshot.session;
    return session ? (session.workingCopy ?? session.artifact.content) : "";
  }

  // Refreshes race the connection teardown: an event can arrive while close()
  // is rejecting in-flight requests, and a fire-and-forget refresh must never
  // surface that as an unhandled rejection.
  private async refreshSession(id: string): Promise<void> {
    try {
      if (this.client) this.update({ session: await this.client.sessionGet(id) });
    } catch (error) {
      if (!this.closed) this.setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  private async refreshInbox(): Promise<void> {
    try {
      if (this.client) this.update({ inbox: await this.client.sessionList({ status: "pending" }) });
    } catch (error) {
      if (!this.closed) this.setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Optimistic apply: the daemon response is the next session snapshot. */
  private apply(mutation: Promise<ReviewSession>): void {
    mutation
      .then((session) => this.update({ session }))
      .catch((error: unknown) =>
        this.setStatus(String(error instanceof Error ? error.message : error)),
      );
  }

  // ── verbs ───────────────────────────────────
  open(id: string): void {
    this.locallyViewed.clear();
    this.rejections = [];
    const cached = this.snapshot.inbox?.find((candidate) => candidate.id === id);
    if (cached) this.update({ session: cached });
    else void this.refreshSession(id);
  }

  deleteSession(id: string): void {
    this.client
      ?.sessionDelete(id)
      .then(() => this.setStatus("plan deleted"))
      .catch((error: unknown) =>
        this.setStatus(`delete failed: ${error instanceof Error ? error.message : String(error)}`),
      );
  }

  setSelfName(name: string): void {
    const session = this.snapshot.session;
    if (!session) return;
    this.apply(this.client!.sessionSetSelfName(session.id, name));
  }

  cut(displayIndex: number): void {
    const session = this.snapshot.session;
    if (!session || session.status === "resolved") return;
    const block = this.display()[displayIndex];
    if (!block) return;
    const working = this.working();
    if (block.type === "del") {
      const line = restoreLine(
        nextWorkBlock(this.display(), displayIndex),
        working.split("\n").length,
      );
      // restoreBlock returns undefined when the block structure round-trips
      // to the submitted revision - the working copy is gone
      const restored = restoreBlock(session.artifact.content, working, block.base!, line);
      this.setWorkingCopy(restored);
      this.setStatus("cut restored");
    } else if (block.work) {
      this.setWorkingCopy(cutBlock(working, block.work));
      this.setStatus("block cut - it serializes into the diff");
    }
  }

  // ── diff hunk curation ──────────────────────
  /** The parsed model and row for a curation action, or null with a status set. */
  private curationRow(rowIndex: number): { row: DiffRow; model: FileDiffMetadata } | null {
    const session = this.snapshot.session;
    if (!session || session.status === "resolved") return null;
    if (!session.artifact.files) {
      this.setStatus("hunk curation needs full file contents (PR diffs cannot be curated)");
      return null;
    }
    const row = this.rows()[rowIndex];
    if (!row || row.kind === "file" || row.kind === "hunk") {
      this.setStatus("move to a code line to curate");
      return null;
    }
    const model = this.derived.models.get(row.file);
    if (!model) return null;
    return { row, model };
  }

  toggleRejectHunk(rowIndex: number): void {
    const located = this.curationRow(rowIndex);
    if (!located) return;
    const target = hunkRejectionForRow(located.row.file, located.model, located.row);
    if (!target) return this.setStatus("no hunk under the cursor");
    const wholeHunk = (rejection: HunkRejection): boolean =>
      rejection.path === target.path &&
      rejection.hunkIndex === target.hunkIndex &&
      rejection.changeIndex === undefined;
    if (this.rejections.some(wholeHunk)) {
      this.rejections = this.rejections.filter((rejection) => !wholeHunk(rejection));
      this.setStatus("hunk restored");
    } else {
      // a whole-hunk reject supersedes any change-level rejects inside it
      this.rejections = this.rejections.filter(
        (rejection) =>
          !(rejection.path === target.path && rejection.hunkIndex === target.hunkIndex),
      );
      this.rejections.push(target);
      this.setStatus("hunk rejected - dropped from the working copy");
    }
    this.recomputeCuration();
  }

  toggleRejectChange(rowIndex: number): void {
    const located = this.curationRow(rowIndex);
    if (!located) return;
    if (located.row.kind !== "add" && located.row.kind !== "del")
      return this.setStatus("move to a changed line to reject a change");
    const target = changeRejectionForRow(located.row.file, located.model, located.row);
    if (!target) return this.setStatus("no change under the cursor");
    const wholeCovers = this.rejections.some(
      (rejection) =>
        rejection.path === target.path &&
        rejection.hunkIndex === target.hunkIndex &&
        rejection.changeIndex === undefined,
    );
    if (wholeCovers) return this.setStatus("the whole hunk is rejected - restore it first");
    if (this.rejections.some((rejection) => sameRejection(rejection, target))) {
      this.rejections = this.rejections.filter((rejection) => !sameRejection(rejection, target));
      this.setStatus("change restored");
    } else {
      this.rejections.push(target);
      this.setStatus("change rejected - dropped from the working copy");
    }
    this.recomputeCuration();
  }

  /** Recompute the curated patch and push it as the working copy (or clear it). */
  private recomputeCuration(): void {
    const files = this.snapshot.session?.artifact.files;
    if (!files) return;
    // no decisions left = the working copy reverts to the full submitted diff
    this.setWorkingCopy(this.rejections.length ? curateDiff(files, this.rejections) : undefined);
    // dimming reads `rejections` directly; a bare update forces the re-read
    this.update({});
  }

  rejectedRows(): Set<number> {
    this.ensureDerived();
    if (!this.rejections.length) return EMPTY_REJECTED_ROWS;
    const rejected = new Set<number>();
    this.derived.rows.forEach((row, index) => {
      const model = this.derived.models.get(row.file);
      if (model && isRowRejected(row.file, model, row, this.rejections)) rejected.add(index);
    });
    return rejected;
  }

  edit(): void {
    const session = this.snapshot.session;
    if (!session || session.status === "resolved") return;
    try {
      const result = editInEditor(this.working(), "plan.md", { editor: this.editor });
      if (result.changed) {
        this.setWorkingCopy(result.content);
        this.reconcileAnnotations(session, result.content);
        this.setStatus("edits tracked - one diff");
      } else this.setStatus("no changes");
    } catch (err) {
      this.setStatus(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Edit-exit reconciliation: re-resolve every annotation against the edited
   * working copy with the quote-primary cascade. Annotations that stop
   * resolving stay stored (the feedback serializer flags orphaned anchors);
   * the count feeds the one-line banner above the sheet.
   */
  private reconcileAnnotations(session: ReviewSession, editedContent: string): void {
    const editedBlocks = parseBlocks(editedContent);
    const orphanCount = session.annotations.filter(
      (annotation) => resolveAnchor(annotation.anchor, editedBlocks) === null,
    ).length;
    this.update({ editOrphanCount: orphanCount });
  }

  annotate(
    kind: "comment" | "suggestion",
    displayIndex: number,
    start: number,
    end: number,
    body: string,
  ): string | undefined {
    const session = this.snapshot.session;
    if (!session) return undefined;
    let anchor;
    if (session.artifact.type === "diff") {
      anchor = { ...diffRowAnchor(this.rows(), displayIndex), blockIndex: displayIndex };
    } else {
      const display = this.display();
      const workBlocks = display.filter((entry) => entry.work).map((entry) => entry.work!);
      const workBlockIndex =
        display.slice(0, displayIndex + 1).filter((entry) => entry.work).length - 1;
      anchor = makeAnchor(workBlocks, workBlockIndex, start, end);
    }
    const wire = { id: newAnnotationId(), kind, anchor, body };
    const persisted = this.client!.sessionAnnotate(session.id, wire);
    this.apply(persisted);
    this.mirrorAnnotation(persisted, wire);
    this.setStatus(
      kind === "suggestion" ? "suggestion added - the agent applies it" : "comment added",
    );
    return wire.id;
  }

  updateAnnotation(id: string, body: string): void {
    const session = this.snapshot.session;
    if (!session) return;
    const existing = session.annotations.find((annotation) => annotation.id === id);
    if (!existing) return;
    // the daemon's annotate verb upserts by id: same id + anchor, new body
    const wire = { id: existing.id, kind: existing.kind, anchor: existing.anchor, body };
    const persisted = this.client!.sessionAnnotate(session.id, wire);
    this.apply(persisted);
    this.mirrorAnnotation(persisted, wire);
    this.setStatus("annotation updated");
  }

  // push only after the local write lands, so a rejected write never leaks to the share
  private mirrorAnnotation(
    persisted: Promise<ReviewSession>,
    annotation: Omit<Annotation, "createdAt">,
  ): void {
    const shareId = this.snapshot.session?.shareId;
    if (!shareId) return;
    void persisted.then(() => pushShare(shareId, [annotation])).catch(() => {});
  }

  removeAnnotation(id: string): void {
    const session = this.snapshot.session;
    if (!session) return;
    this.apply(this.client!.sessionRemoveAnnotation(session.id, id));
    this.setStatus("annotation deleted");
  }

  setWorkingCopy(content: string | undefined): void {
    const session = this.snapshot.session;
    if (!session) return;
    this.apply(this.client!.sessionSetWorkingCopy(session.id, content));
  }

  // ── the guided walk ─────────────────────────
  // Marks sent but possibly not yet reflected in the session snapshot; the
  // union keeps the walk title truthful and rapid advances from losing marks.
  private locallyViewed = new Set<string>();

  private viewedSet(): Set<string> {
    return new Set([...(this.snapshot.session?.viewedPaths ?? []), ...this.locallyViewed]);
  }

  walkStart(): void {
    const session = this.snapshot.session;
    if (!session || session.artifact.type !== "diff") return;
    const files = this.files();
    if (files.length === 0) return this.setStatus("nothing to walk - the diff is empty");
    // resume at the first unviewed file; a finished walk reopens on the end card
    this.update({ walk: { index: firstUnviewedIndex(files, this.viewedSet()) } });
  }

  walkForward(): void {
    const walk = this.snapshot.walk;
    const session = this.snapshot.session;
    if (!walk || !session) return;
    const files = this.files();
    const current = files[walk.index];
    if (!current) return; // already on the end card
    // advancing IS the viewed mark: the step is complete once you move past
    // it; the daemon verb merges, so only the new path travels
    if (!this.viewedSet().has(current.path)) {
      this.locallyViewed.add(current.path);
      this.apply(this.client!.sessionSetViewed(session.id, [current.path]));
    }
    this.update({ walk: { index: walk.index + 1 } });
  }

  walkBack(): void {
    const walk = this.snapshot.walk;
    if (!walk) return;
    this.update({ walk: { index: Math.max(0, walk.index - 1) } });
  }

  walkLeave(): void {
    if (this.snapshot.walk) this.update({ walk: null });
  }

  submit(verdict: VerdictKind, summary: string): void {
    const session = this.snapshot.session;
    if (!session) return;
    this.walkLeave();
    this.client!.sessionResolve(session.id, verdict, summary)
      .then((resolved) => {
        // The completion overlay heading already states the verdict, so the
        // status line stays empty here - only export/error messages fill it.
        this.update({ session: resolved, status: "" });
        // notes-vault export: guarded by each exporter's policy (default manual = no-op)
        for (const exporter of this.exporters) {
          if (!exporter.runsOn(verdict)) continue;
          void exporter.run(resolved).then((exportResult) => {
            this.setStatus(
              exportResult.success && exportResult.path
                ? `exported to ${exportResult.path}`
                : `export failed: ${exportResult.error ?? "unknown"}`,
            );
          });
        }
        // Hand the reviewer back to the agent. The default is a visible
        // countdown from DEFAULT_AUTO_CLOSE that closes on its own; esc stays,
        // a remembers the choice. A configured delay overrides; 0 closes now.
        const delay = this.autoClose;
        if (delay === 0) this.finishReview();
        else if (typeof delay === "number") this.startCounting(delay);
        else this.startCounting(DEFAULT_AUTO_CLOSE);
      })
      .catch((error: unknown) =>
        this.setStatus(String(error instanceof Error ? error.message : error)),
      );
  }

  share(): void {
    const session = this.snapshot.session;
    if (!session) return;
    this.setStatus("sharing…");
    publishShare(session)
      .then(async ({ line, copied }) => {
        // Stamp the id back so a later pull knows which share to collect from.
        const shareId = shareIdFromLine(line);
        if (shareId && this.client) await this.client.sessionSetShareId(session.id, shareId);
        this.setStatus("");
        this.showToast(line, copied ? "share link copied" : "share link");
      })
      .catch((error: unknown) =>
        this.setStatus(`share failed: ${error instanceof Error ? error.message : String(error)}`),
      );
  }

  /**
   * Pull collaborator notes for a shared plan and union them in, awaiting the
   * merge so a poll never overlaps rounds. The daemon's merge emits
   * session.updated, so the re-render happens through the normal event path.
   * Best-effort: a failed refresh is silent and the next tick retries.
   */
  pullShared(): Promise<void> {
    const session = this.snapshot.session;
    if (!session?.shareId || !this.client) return Promise.resolve();
    const client = this.client;
    return pullShare(session.shareId)
      .then((remote) =>
        client.sessionMergeShared(session.id, {
          annotations: collaboratorAnnotations(remote),
          participants: remote.participants,
        }),
      )
      .then(() => {})
      .catch(() => {});
  }

  /**
   * Poll the share for collaborator notes while it is open: pull now, then again
   * every few seconds, each round waiting for the last so slow pulls never stack.
   * Returns a stop handle the caller runs on leave.
   */
  startSharePoll(): () => void {
    this.stopSharePoll();
    // per-run token so a stale run's in-flight pull never re-arms the poll
    const run = {};
    this.shareRun = run;
    const tick = (): void => {
      void this.pullShared().finally(() => {
        if (this.shareRun === run && !this.closed)
          this.sharePoll = this.clock.setTimeout(tick, SHARE_POLL_MS);
      });
    };
    tick();
    return () => {
      if (this.shareRun === run) this.stopSharePoll();
    };
  }

  private stopSharePoll(): void {
    this.shareRun = null;
    if (this.sharePoll !== undefined) this.clock.clearTimeout(this.sharePoll);
    this.sharePoll = undefined;
  }

  // ── completion hand-back ────────────────────
  private startCounting(remaining: number): void {
    if (remaining <= 0) return this.finishReview();
    this.update({ completion: { phase: "counting", remaining } });
    this.countdown = this.clock.setTimeout(() => this.startCounting(remaining - 1), 1000);
  }

  finishReview(): void {
    this.clearCountdown();
    const herdr = detectHerdr();
    const pane = returnPaneFor(this.snapshot.session?.artifact.meta.herdrPane);
    if (herdr && pane) focusHerdrPane(herdr.binPath, pane);
    this.options.onExit?.(0);
  }

  dismissCompletion(): void {
    this.clearCountdown();
    this.update({ completion: { phase: "dismissed" } });
  }

  optInAutoClose(): void {
    // Remember the default countdown for future submits, persisted to the user
    // config. The countdown is already running; this only makes it the default.
    try {
      persistAutoClose(DEFAULT_AUTO_CLOSE);
    } catch {
      // a read-only config dir must not block closing the review
    }
    this.autoClose = DEFAULT_AUTO_CLOSE;
  }

  saveReviewPanel(layout: { mode?: ReviewPanelMode; width?: number }): void {
    try {
      if (layout.mode !== undefined) persistReviewState(layout.mode);
      if (layout.width !== undefined) persistReviewWidth(layout.width);
    } catch {
      // a read-only config dir must never block collapsing or resizing the rail
    }
  }
}
