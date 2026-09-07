/**
 * The intent reducer: one effectful handler per keymap Intent, lifted out of
 * the App component so the 30-case grammar can be read and tested on its own.
 * keymap.ts turns keys into Intents (pure); this turns an Intent into the
 * matching controller call or view-state update. App builds the dependency
 * bag once per render and hands it here; nothing in this module reaches back
 * into React beyond the setters it is given.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { isAddressed, isAgentNote, type ReviewSession, type VerdictKind } from "@cueloop/schema";
import { displayText, spanKey, startSpan, type DisplayBlock, type SpanState } from "./view-plan";
import type { DiffRow } from "./view-diff";
import type { ReviewController } from "./session-controller";
import type { Intent } from "./keymap";
import type { TreeRow } from "./tree-view";
import { quickActionBody, type QuickAction } from "./config";
import { VERDICTS } from "./components/ConfirmCard";

/** Which pane of the session tree / review the keyboard grammar is aimed at. */
export type RailTab = "review" | "agent" | "tree";

/** The one overlay/mode the TUI is in; every compose/submit/edit flow is a variant. */
export type Mode =
  | { type: "normal" }
  | { type: "span"; span: SpanState }
  | { type: "spanActions"; span: SpanState; index: number }
  | {
      type: "compose";
      kind: "comment";
      displayIndex: number;
      start: number;
      end: number;
      text: string;
    }
  | { type: "railEdit"; id: string; text: string }
  | { type: "submit"; verdict: VerdictKind; summary: string }
  | { type: "confirmDelete"; sessionId: string; title: string }
  | { type: "rename"; authorId: string; text: string }
  | { type: "renameThread"; sessionId: string; text: string }
  | { type: "nameSelf"; text: string }
  | { type: "treePrompt"; ask: TreeAsk; entryId?: string; text: string };

/** What a tree prompt asks for: a branch name, a checkpoint name, or the summary a move back leaves. */
export type TreeAsk = "branch" | "label" | "navigate";

/** The marked span for span mode and its quick-actions sub-mode; null otherwise. */
export function activeSpanState(mode: Mode): SpanState | null {
  return mode.type === "span" || mode.type === "spanActions" ? mode.span : null;
}

/**
 * Annotations that still count as feedback: agent notes never do, and an
 * annotation a revision already addressed is settled - it neither blocks the
 * verdict default nor re-enters the next feedback document.
 */
export function reviewerAnnotations(session: ReviewSession) {
  return session.annotations.filter(
    (annotation) => !isAgentNote(annotation) && !isAddressed(annotation),
  );
}

export function defaultVerdict(session: ReviewSession): VerdictKind {
  return reviewerAnnotations(session).length || session.workingCopy !== undefined
    ? "request_changes"
    : "approve";
}

/**
 * Everything the reducer reads or writes, supplied fresh each render: the
 * controller and exit hook, the derived reads (view rows, cursor, mode,
 * session), the refs it pokes, the state setters, and the three App-owned
 * selection helpers it composes.
 */
export interface IntentDispatchDeps {
  controller: ReviewController;
  onExit?: (code: number) => void;

  isDiff: boolean;
  display: DisplayBlock[];
  rows: DiffRow[];
  cursor: number;
  inbox: ReviewSession[] | null;
  inboxCursor: number;
  mode: Mode;
  session: ReviewSession | null;
  focusedAnnotationId: string | undefined;
  /** The curation item selected for undo, if any. */
  selectedCurationId: string | undefined;
  railTab: RailTab;
  /** The tree row selected in the session tree; the target of go. */
  selectedEntryId: string | undefined;
  /** Planner-local author renames, for seeding the rename prompt. */
  authorNames: Record<string, string>;
  /** Marker-popover quick actions, in list order; picking one inserts a preset comment. */
  quickActions: QuickAction[];
  /** Persist an author rename and update the live overrides (App-owned). */
  renameAuthor: (id: string, name: string) => void;
  /** Rename a thread's title through the daemon. */
  renameThread: (id: string, title: string) => void;

  liveInput: MutableRefObject<string>;

  setCursor: Dispatch<SetStateAction<number>>;
  setInboxCursor: Dispatch<SetStateAction<number>>;
  setMode: Dispatch<SetStateAction<Mode>>;
  setRailTab: Dispatch<SetStateAction<RailTab>>;
  setSelectedEntryId: Dispatch<SetStateAction<string | undefined>>;
  setFocusedAnnotationId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedCurationId: Dispatch<SetStateAction<string | undefined>>;
  setPulsedAnnotationId: Dispatch<SetStateAction<string | null>>;

  selectCardFromDocument: (annotationId: string) => void;
  runEditorHandOff: () => void;
  openCardEdit: (annotationId: string) => void;
}

type IntentOfType<Kind extends Intent["type"]> = Extract<Intent, { type: Kind }>;

function handleExit(_intent: IntentOfType<"exit">, deps: IntentDispatchDeps): void {
  deps.onExit?.(0);
}

function handleStatus(intent: IntentOfType<"status">, deps: IntentDispatchDeps): void {
  deps.controller.setStatus(intent.message);
}

/** A diff cursor rests on code lines only; file and hunk headers are structural dividers. */
function isCodeRow(row: DiffRow | undefined): boolean {
  return row?.kind === "ctx" || row?.kind === "add" || row?.kind === "del";
}

/**
 * A landable diff row: any code line, plus a collapsed file's band (a file row with
 * no body before the next file or the end) so the cursor can reach it to expand it.
 */
function isLandableRow(rows: DiffRow[], index: number): boolean {
  const row = rows[index];

  if (isCodeRow(row)) return true;
  if (row?.kind !== "file") return false;
  const next = rows[index + 1];

  return next === undefined || next.kind === "file";
}

/** The next landable index in the move direction, skipping expanded headers; stays put at an edge. */
function nextCodeRowIndex(rows: DiffRow[], from: number, to: IntentOfType<"move">["to"]): number {
  if (to === "top") {
    for (let index = 0; index < rows.length; index++) if (isLandableRow(rows, index)) return index;

    return from;
  }
  if (to === "bottom") {
    for (let index = rows.length - 1; index >= 0; index--) {
      if (isLandableRow(rows, index)) return index;
    }

    return from;
  }
  const step = to === "down" ? 1 : -1;

  for (let index = from + step; index >= 0 && index < rows.length; index += step) {
    if (isLandableRow(rows, index)) return index;
  }

  return from;
}

function handleMove(intent: IntentOfType<"move">, deps: IntentDispatchDeps): void {
  if (deps.isDiff) {
    deps.setCursor((current) => nextCodeRowIndex(deps.rows, current, intent.to));

    return;
  }
  const navigableCount = deps.display.length;

  if (intent.to === "down") deps.setCursor((current) => Math.min(navigableCount - 1, current + 1));
  else if (intent.to === "up") deps.setCursor((current) => Math.max(0, current - 1));
  else if (intent.to === "top") deps.setCursor(0);
  else deps.setCursor(navigableCount - 1);
}

function handleInboxMove(intent: IntentOfType<"inboxMove">, deps: IntentDispatchDeps): void {
  const navigableCount = deps.inbox?.length ?? 0;

  deps.setInboxCursor((current) =>
    intent.to === "down" ? Math.min(navigableCount - 1, current + 1) : Math.max(0, current - 1),
  );
}

function handleOpenSession(_intent: IntentOfType<"openSession">, deps: IntentDispatchDeps): void {
  const selected = deps.inbox?.[deps.inboxCursor];

  if (selected) deps.controller.open(selected.id);
}

function handleRequestDeleteSession(
  _intent: IntentOfType<"requestDeleteSession">,
  deps: IntentDispatchDeps,
): void {
  const selected = deps.inbox?.[deps.inboxCursor];

  if (selected)
    deps.setMode({
      type: "confirmDelete",
      sessionId: selected.id,
      title: selected.artifact.meta.title ?? selected.id,
    });
}

function handleOpenRename(_intent: IntentOfType<"openRename">, deps: IntentDispatchDeps): void {
  const focused = deps.session?.annotations.find(
    (annotation) => annotation.id === deps.focusedAnnotationId,
  );

  if (!focused?.author) {
    deps.controller.setStatus("that is your own note - nothing to rename");

    return;
  }
  deps.setMode({
    type: "rename",
    authorId: focused.author,
    text: deps.authorNames[focused.author] ?? "",
  });
}

function handleConfirmDialog(
  _intent: IntentOfType<"confirmDialog">,
  deps: IntentDispatchDeps,
): void {
  const { mode, controller } = deps;

  if (mode.type === "confirmDelete") controller.deleteSession(mode.sessionId);
  else if (mode.type === "rename") deps.renameAuthor(mode.authorId, mode.text.trim());
  else if (mode.type === "renameThread") deps.renameThread(mode.sessionId, mode.text.trim());
  else if (mode.type === "nameSelf") controller.setSelfName(mode.text.trim());
  else if (mode.type === "treePrompt") confirmTreePrompt(mode, deps);
  deps.setMode({ type: "normal" });
}

function handleStartSpan(_intent: IntentOfType<"startSpan">, deps: IntentDispatchDeps): void {
  const block = deps.display[deps.cursor];

  if (!block?.work) return;
  const span = startSpan(deps.cursor, displayText(block));

  if (span) deps.setMode({ type: "span", span });
}

function handleSpanKey(intent: IntentOfType<"spanKey">, deps: IntentDispatchDeps): void {
  const { mode } = deps;

  if (mode.type === "span") {
    const span = spanKey(
      mode.span,
      intent.name,
      displayText(deps.display[mode.span.displayIndex]!),
    );

    deps.setMode({ type: "span", span });
  }
}

function handleSpanCut(_intent: IntentOfType<"spanCut">, deps: IntentDispatchDeps): void {
  // the block the span sits in, cut whole (partial-span cut is not modeled)
  const { mode } = deps;

  if (mode.type === "span") {
    deps.controller.cut(mode.span.displayIndex);
    deps.setMode({ type: "normal" });
  }
}

function handleOpenSpanActions(
  _intent: IntentOfType<"openSpanActions">,
  deps: IntentDispatchDeps,
): void {
  const { mode } = deps;

  if (mode.type === "span") deps.setMode({ type: "spanActions", span: mode.span, index: 0 });
}

function handleMoveSpanAction(
  intent: IntentOfType<"moveSpanAction">,
  deps: IntentDispatchDeps,
): void {
  const { mode } = deps;

  if (mode.type === "spanActions") {
    const index = Math.max(
      0,
      Math.min(deps.quickActions.length - 1, mode.index + intent.direction),
    );

    deps.setMode({ ...mode, index });
  }
}

function handleCloseSpanActions(
  _intent: IntentOfType<"closeSpanActions">,
  deps: IntentDispatchDeps,
): void {
  const { mode } = deps;

  if (mode.type === "spanActions") deps.setMode({ type: "span", span: mode.span });
}

function handlePickSpanAction(
  intent: IntentOfType<"pickSpanAction">,
  deps: IntentDispatchDeps,
): void {
  const { mode, session, controller } = deps;

  if (mode.type !== "spanActions") return;
  const action = deps.quickActions[intent.index ?? mode.index];

  if (session && action) {
    const body = quickActionBody(action);
    const annotationId = controller.annotate(
      "comment",
      mode.span.displayIndex,
      mode.span.start,
      mode.span.end,
      body,
    );

    if (annotationId) deps.setFocusedAnnotationId(annotationId);
  }
  deps.setMode({ type: "normal" });
}

function handleOpenCompose(intent: IntentOfType<"openCompose">, deps: IntentDispatchDeps): void {
  const { mode } = deps;

  deps.liveInput.current = "";
  if (intent.from === "span" && mode.type === "span") {
    deps.setMode({
      type: "compose",
      kind: intent.kind,
      displayIndex: mode.span.displayIndex,
      start: mode.span.start,
      end: mode.span.end,
      text: "",
    });
  } else if (deps.isDiff) {
    const row = deps.rows[deps.cursor];

    if (row)
      deps.setMode({
        type: "compose",
        kind: intent.kind,
        displayIndex: deps.cursor,
        start: 0,
        end: row.text.length,
        text: "",
      });
  } else {
    const block = deps.display[deps.cursor];

    if (block)
      deps.setMode({
        type: "compose",
        kind: intent.kind,
        displayIndex: deps.cursor,
        start: 0,
        end: displayText(block).length,
        text: "",
      });
  }
}

function handleOpenSubmit(_intent: IntentOfType<"openSubmit">, deps: IntentDispatchDeps): void {
  const { session } = deps;

  if (!session) return;
  deps.liveInput.current = "";
  deps.setMode({ type: "submit", verdict: defaultVerdict(session), summary: "" });
}

function handleShare(_intent: IntentOfType<"share">, deps: IntentDispatchDeps): void {
  deps.controller.share();
}

function handleCut(_intent: IntentOfType<"cut">, deps: IntentDispatchDeps): void {
  deps.controller.cut(deps.cursor);
}

function handleRejectHunk(_intent: IntentOfType<"rejectHunk">, deps: IntentDispatchDeps): void {
  deps.controller.toggleRejectHunk(deps.cursor);
}

function handleRejectChange(_intent: IntentOfType<"rejectChange">, deps: IntentDispatchDeps): void {
  deps.controller.toggleRejectChange(deps.cursor);
}

function handleFoldFile(_intent: IntentOfType<"foldFile">, deps: IntentDispatchDeps): void {
  const file = deps.rows[deps.cursor]?.file;

  if (!file || deps.controller.isFileCollapsed(file)) return;
  deps.controller.setFileCollapsed(file, true);
  // the file band is unchanged in index by its own collapse, so land the cursor on it
  const headerIndex = deps.controller
    .rows()
    .findIndex((row) => row.kind === "file" && row.file === file);

  if (headerIndex >= 0) deps.setCursor(headerIndex);
}

function handleUnfoldFile(_intent: IntentOfType<"unfoldFile">, deps: IntentDispatchDeps): void {
  const file = deps.rows[deps.cursor]?.file;

  if (!file || !deps.controller.isFileCollapsed(file)) return;
  deps.controller.setFileCollapsed(file, false);
  // drop the cursor onto the file's first code line now that its body is back
  const firstCode = deps.controller.rows().findIndex((row) => row.file === file && isCodeRow(row));

  if (firstCode >= 0) deps.setCursor(firstCode);
}

function handleRestoreCuration(
  _intent: IntentOfType<"restoreCuration">,
  deps: IntentDispatchDeps,
): void {
  // undo the selected curated-out item, or the last rejected when none is
  // selected, so a bare `u` reads as "undo my last curation"
  const items = deps.controller.curationItems();

  if (!items.length) return;
  const targetId = deps.selectedCurationId ?? items[items.length - 1]!.id;

  deps.controller.restoreCuration(targetId);
  deps.setSelectedCurationId(undefined);
}

function handleEdit(_intent: IntentOfType<"edit">, deps: IntentDispatchDeps): void {
  deps.runEditorHandOff();
}

function handleEditCard(_intent: IntentOfType<"editCard">, deps: IntentDispatchDeps): void {
  if (deps.focusedAnnotationId) deps.openCardEdit(deps.focusedAnnotationId);
}

function handleAnnotationCycle(
  intent: IntentOfType<"nextAnnotation" | "prevAnnotation">,
  deps: IntentDispatchDeps,
): void {
  // cycle open cards only - addressed ones are out of the rail
  const annotations = (deps.session?.annotations ?? []).filter(
    (annotation) => !isAddressed(annotation),
  );

  if (!annotations.length) return;
  const focusedIndex = annotations.findIndex(
    (annotation) => annotation.id === deps.focusedAnnotationId,
  );
  const nextIndex =
    focusedIndex === -1
      ? 0
      : (focusedIndex + (intent.type === "nextAnnotation" ? 1 : -1) + annotations.length) %
        annotations.length;

  deps.selectCardFromDocument(annotations[nextIndex]!.id);
}

function handleWalkStart(_intent: IntentOfType<"walkStart">, deps: IntentDispatchDeps): void {
  deps.controller.walkStart();
}

function handleWalkForward(_intent: IntentOfType<"walkForward">, deps: IntentDispatchDeps): void {
  deps.controller.walkForward();
}

function handleWalkBack(_intent: IntentOfType<"walkBack">, deps: IntentDispatchDeps): void {
  deps.controller.walkBack();
}

function handleWalkLeave(_intent: IntentOfType<"walkLeave">, deps: IntentDispatchDeps): void {
  deps.controller.walkLeave();
}

function handleRemoveAnnotation(
  _intent: IntentOfType<"removeAnnotation">,
  deps: IntentDispatchDeps,
): void {
  if (deps.focusedAnnotationId) {
    deps.controller.removeAnnotation(deps.focusedAnnotationId);
    deps.setFocusedAnnotationId(undefined);
  }
}

function handleDeselect(_intent: IntentOfType<"deselect">, deps: IntentDispatchDeps): void {
  deps.setFocusedAnnotationId(undefined);
  deps.setPulsedAnnotationId(null);
}

function handleCloseOverlay(_intent: IntentOfType<"closeOverlay">, deps: IntentDispatchDeps): void {
  deps.setMode({ type: "normal" });
}

function handleSaveCompose(_intent: IntentOfType<"saveCompose">, deps: IntentDispatchDeps): void {
  const { mode, session, controller } = deps;
  const body = deps.liveInput.current.trim();

  if (mode.type === "railEdit") {
    if (session && body) controller.updateAnnotation(mode.id, body);
    deps.setMode({ type: "normal" });

    return;
  }
  if (mode.type !== "compose") return;
  if (session && body) {
    const annotationId = controller.annotate(
      mode.kind,
      mode.displayIndex,
      mode.start,
      mode.end,
      body,
    );

    if (annotationId) deps.setFocusedAnnotationId(annotationId);
  }
  deps.setMode({ type: "normal" });
}

function handleSubmitVerdict(
  _intent: IntentOfType<"submitVerdict">,
  deps: IntentDispatchDeps,
): void {
  const { mode } = deps;

  if (mode.type === "submit") deps.controller.submit(mode.verdict, deps.liveInput.current);
  deps.setMode({ type: "normal" });
}

function handleCycleVerdict(intent: IntentOfType<"cycleVerdict">, deps: IntentDispatchDeps): void {
  const { mode } = deps;

  if (mode.type !== "submit") return;
  const verdictIndex =
    (VERDICTS.indexOf(mode.verdict) + intent.direction + VERDICTS.length) % VERDICTS.length;

  deps.setMode({ ...mode, verdict: VERDICTS[verdictIndex]! });
}

function handleFinishReview(_intent: IntentOfType<"finishReview">, deps: IntentDispatchDeps): void {
  deps.controller.finishReview();
}

function handleOptInAutoClose(
  _intent: IntentOfType<"optInAutoClose">,
  deps: IntentDispatchDeps,
): void {
  deps.controller.optInAutoClose();
}

function handleDismissCompletion(
  _intent: IntentOfType<"dismissCompletion">,
  deps: IntentDispatchDeps,
): void {
  deps.controller.dismissCompletion();
}

function confirmTreePrompt(
  mode: Extract<Mode, { type: "treePrompt" }>,
  deps: IntentDispatchDeps,
): void {
  if (mode.ask === "branch") deps.controller.branch(mode.text);
  else if (mode.ask === "label") deps.controller.labelTip(mode.text);
  else if (mode.entryId !== undefined) deps.controller.goToEntry(mode.entryId, mode.text.trim());
}

function handleToggleTree(_intent: IntentOfType<"toggleTree">, deps: IntentDispatchDeps): void {
  deps.setRailTab(deps.railTab === "tree" ? "review" : "tree");
}

/** The tree rows in drawing order; the selection falls back to the current tip. */
function selectedTreeIndex(deps: IntentDispatchDeps, rows: TreeRow[]): number {
  const byId = rows.findIndex((row) => row.entryId === deps.selectedEntryId);

  return byId === -1 ? rows.findIndex((row) => row.isCurrentTip) : byId;
}

function handleTreeMove(intent: IntentOfType<"treeMove">, deps: IntentDispatchDeps): void {
  const rows = deps.controller.treeRows();

  if (rows.length === 0) return;
  const current = selectedTreeIndex(deps, rows);
  const next = Math.min(rows.length - 1, Math.max(0, current + intent.direction));

  deps.setSelectedEntryId(rows[next]!.entryId);
}

function handleTreeGo(_intent: IntentOfType<"treeGo">, deps: IntentDispatchDeps): void {
  const rows = deps.controller.treeRows();
  const row = rows[selectedTreeIndex(deps, rows)];

  if (!row) return deps.controller.setStatus("select an entry in the tree first");
  if (row.isCurrentTip) return deps.controller.setStatus("already at the tip");
  // a switch needs no summary; a move back may leave one, so it asks
  if (row.tips.length > 0) return deps.controller.goToEntry(row.entryId);
  deps.setMode({ type: "treePrompt", ask: "navigate", entryId: row.entryId, text: "" });
}

function handleTreeBranch(_intent: IntentOfType<"treeBranch">, deps: IntentDispatchDeps): void {
  deps.setMode({ type: "treePrompt", ask: "branch", text: "" });
}

function handleTreeLabel(_intent: IntentOfType<"treeLabel">, deps: IntentDispatchDeps): void {
  deps.setMode({ type: "treePrompt", ask: "label", text: "" });
}

function handleTreeFork(_intent: IntentOfType<"treeFork">, deps: IntentDispatchDeps): void {
  deps.controller.fork();
}

function handleTreeForkShare(
  _intent: IntentOfType<"treeForkShare">,
  deps: IntentDispatchDeps,
): void {
  deps.controller.forkAndShare();
}

type IntentHandlers = {
  [Kind in Intent["type"]]: (intent: IntentOfType<Kind>, deps: IntentDispatchDeps) => void;
};

const intentHandlers: IntentHandlers = {
  exit: handleExit,
  status: handleStatus,
  move: handleMove,
  inboxMove: handleInboxMove,
  openSession: handleOpenSession,
  requestDeleteSession: handleRequestDeleteSession,
  openRename: handleOpenRename,
  confirmDialog: handleConfirmDialog,
  startSpan: handleStartSpan,
  spanKey: handleSpanKey,
  spanCut: handleSpanCut,
  openSpanActions: handleOpenSpanActions,
  moveSpanAction: handleMoveSpanAction,
  closeSpanActions: handleCloseSpanActions,
  pickSpanAction: handlePickSpanAction,
  openCompose: handleOpenCompose,
  openSubmit: handleOpenSubmit,
  share: handleShare,
  cut: handleCut,
  rejectHunk: handleRejectHunk,
  rejectChange: handleRejectChange,
  foldFile: handleFoldFile,
  unfoldFile: handleUnfoldFile,
  restoreCuration: handleRestoreCuration,
  edit: handleEdit,
  editCard: handleEditCard,
  nextAnnotation: handleAnnotationCycle,
  prevAnnotation: handleAnnotationCycle,
  walkStart: handleWalkStart,
  walkForward: handleWalkForward,
  walkBack: handleWalkBack,
  walkLeave: handleWalkLeave,
  removeAnnotation: handleRemoveAnnotation,
  deselect: handleDeselect,
  closeOverlay: handleCloseOverlay,
  saveCompose: handleSaveCompose,
  submitVerdict: handleSubmitVerdict,
  cycleVerdict: handleCycleVerdict,
  finishReview: handleFinishReview,
  optInAutoClose: handleOptInAutoClose,
  dismissCompletion: handleDismissCompletion,
  toggleTree: handleToggleTree,
  treeMove: handleTreeMove,
  treeGo: handleTreeGo,
  treeBranch: handleTreeBranch,
  treeLabel: handleTreeLabel,
  treeFork: handleTreeFork,
  treeForkShare: handleTreeForkShare,
};

function dispatchIntent<Kind extends Intent["type"]>(
  intent: IntentOfType<Kind>,
  deps: IntentDispatchDeps,
): void {
  intentHandlers[intent.type](intent, deps);
}

/** Build the intent handler for one render from its dependency bag. */
export function createIntentDispatch(deps: IntentDispatchDeps): (intent: Intent) => void {
  return (intent: Intent): void => dispatchIntent(intent, deps);
}
