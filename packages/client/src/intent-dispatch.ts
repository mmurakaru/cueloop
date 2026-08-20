/**
 * The intent reducer: one effectful handler per keymap Intent, lifted out of
 * the App component so the 30-case grammar can be read and tested on its own.
 * keymap.ts turns keys into Intents (pure); this turns an Intent into the
 * matching controller call or view-state update. App builds the dependency
 * bag once per render and hands it here; nothing in this module reaches back
 * into React beyond the setters it is given.
 */

import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { isAddressed, isAgentNote, type ReviewSession, type VerdictKind } from "@cueloop/schema";
import { displayText, spanKey, startSpan, type DisplayBlock, type SpanState } from "./view-plan";
import type { DiffRow } from "./view-diff";
import type { ReviewController } from "./session-controller";
import type { Intent } from "./keymap";
import type { QuickAction } from "./config";
import type { PlanSheetHandle } from "./components/PlanSheet";
import { VERDICTS } from "./components/ConfirmCard";
import {
  REVIEW_RESIZE_STEP,
  cycleReviewPanelMode,
  resolveReviewWidth,
  type ReviewPanelMode,
} from "./review-panel";

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
  | { type: "nameSelf"; text: string };

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
  reviewMode: ReviewPanelMode;
  reviewWidth: number;
  terminalWidth: number;
  focusedAnnotationId: string | undefined;
  /** The curation item selected in the rail, if any; the undo target when set. */
  selectedCurationId: string | undefined;
  /** Planner-local author renames, for seeding the rename prompt. */
  authorNames: Record<string, string>;
  /** Marker-popover quick actions, in list order; picking one inserts a preset comment. */
  quickActions: QuickAction[];
  /** Persist an author rename and update the live overrides (App-owned). */
  renameAuthor: (id: string, name: string) => void;

  liveInput: MutableRefObject<string>;
  reviewWidthRef: MutableRefObject<number>;
  planSheetRef: RefObject<PlanSheetHandle | null>;

  setCursor: Dispatch<SetStateAction<number>>;
  setInboxCursor: Dispatch<SetStateAction<number>>;
  setMode: Dispatch<SetStateAction<Mode>>;
  setReviewMode: Dispatch<SetStateAction<ReviewPanelMode>>;
  setReviewWidth: Dispatch<SetStateAction<number>>;
  setRailTab: Dispatch<SetStateAction<"review" | "agent">>;
  setFocusedAnnotationId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedCurationId: Dispatch<SetStateAction<string | undefined>>;
  setPulsedAnnotationId: Dispatch<SetStateAction<string | null>>;

  selectCardFromDocument: (annotationId: string) => void;
  runEditorHandOff: () => void;
  openCardEdit: (annotationId: string) => void;
}

/** Build the intent handler for one render from its dependency bag. */
export function createIntentDispatch(deps: IntentDispatchDeps): (intent: Intent) => void {
  const {
    controller,
    onExit,
    isDiff,
    display,
    rows,
    cursor,
    inbox,
    inboxCursor,
    mode,
    session,
    reviewMode,
    reviewWidth,
    terminalWidth,
    focusedAnnotationId,
    selectedCurationId,
    authorNames,
    quickActions,
    renameAuthor,
    liveInput,
    reviewWidthRef,
    planSheetRef,
    setCursor,
    setInboxCursor,
    setMode,
    setReviewMode,
    setReviewWidth,
    setRailTab,
    setFocusedAnnotationId,
    setSelectedCurationId,
    setPulsedAnnotationId,
    selectCardFromDocument,
    runEditorHandOff,
    openCardEdit,
  } = deps;

  return (intent: Intent): void => {
    switch (intent.type) {
      case "exit":
        return void onExit?.(0);
      case "status":
        return controller.setStatus(intent.message);
      case "move": {
        const navigableCount = isDiff ? rows.length : display.length;
        if (intent.to === "down") setCursor((current) => Math.min(navigableCount - 1, current + 1));
        else if (intent.to === "up") setCursor((current) => Math.max(0, current - 1));
        else if (intent.to === "top") setCursor(0);
        else setCursor(navigableCount - 1);
        return;
      }
      case "inboxMove": {
        const navigableCount = inbox?.length ?? 0;
        setInboxCursor((current) =>
          intent.to === "down"
            ? Math.min(navigableCount - 1, current + 1)
            : Math.max(0, current - 1),
        );
        return;
      }
      case "openSession": {
        const selected = inbox?.[inboxCursor];
        if (selected) controller.open(selected.id);
        return;
      }
      case "requestDeleteSession": {
        const selected = inbox?.[inboxCursor];
        if (selected)
          setMode({
            type: "confirmDelete",
            sessionId: selected.id,
            title: selected.artifact.meta.title ?? selected.id,
          });
        return;
      }
      case "openRename": {
        const focused = session?.annotations.find(
          (annotation) => annotation.id === focusedAnnotationId,
        );
        if (!focused?.author)
          return void controller.setStatus("that is your own note - nothing to rename");
        return void setMode({
          type: "rename",
          authorId: focused.author,
          text: authorNames[focused.author] ?? "",
        });
      }
      case "confirmDialog": {
        if (mode.type === "confirmDelete") controller.deleteSession(mode.sessionId);
        else if (mode.type === "rename") renameAuthor(mode.authorId, mode.text.trim());
        else if (mode.type === "nameSelf") controller.setSelfName(mode.text.trim());
        return void setMode({ type: "normal" });
      }
      case "startSpan": {
        const block = display[cursor];
        if (!block?.work) return;
        const span = startSpan(cursor, displayText(block));
        if (span) setMode({ type: "span", span });
        return;
      }
      case "spanKey":
        if (mode.type === "span") {
          const span = spanKey(
            mode.span,
            intent.name,
            displayText(display[mode.span.displayIndex]!),
          );
          setMode({ type: "span", span });
        }
        return;
      case "spanCut":
        // the block the span sits in, cut whole (partial-span cut is not modeled)
        if (mode.type === "span") {
          controller.cut(mode.span.displayIndex);
          setMode({ type: "normal" });
        }
        return;
      case "openSpanActions":
        if (mode.type === "span") setMode({ type: "spanActions", span: mode.span, index: 0 });
        return;
      case "moveSpanAction":
        if (mode.type === "spanActions") {
          const index = Math.max(
            0,
            Math.min(quickActions.length - 1, mode.index + intent.direction),
          );
          setMode({ ...mode, index });
        }
        return;
      case "closeSpanActions":
        if (mode.type === "spanActions") setMode({ type: "span", span: mode.span });
        return;
      case "pickSpanAction": {
        if (mode.type !== "spanActions") return;
        const action = quickActions[intent.index ?? mode.index];
        if (session && action) {
          const body = action.metadata ? `${action.prompt}\n\n${action.metadata}` : action.prompt;
          const annotationId = controller.annotate(
            "comment",
            mode.span.displayIndex,
            mode.span.start,
            mode.span.end,
            body,
          );
          if (annotationId) setFocusedAnnotationId(annotationId);
        }
        return void setMode({ type: "normal" });
      }
      case "openCompose": {
        liveInput.current = "";
        if (intent.from === "span" && mode.type === "span") {
          setMode({
            type: "compose",
            kind: intent.kind,
            displayIndex: mode.span.displayIndex,
            start: mode.span.start,
            end: mode.span.end,
            text: "",
          });
        } else if (isDiff) {
          const row = rows[cursor];
          if (row)
            setMode({
              type: "compose",
              kind: intent.kind,
              displayIndex: cursor,
              start: 0,
              end: row.text.length,
              text: "",
            });
        } else {
          // a mouse drag leaves a native selection; it wins over the cursor block
          const native = planSheetRef.current?.readSelection() ?? null;
          if (native) {
            setMode({ type: "compose", kind: intent.kind, ...native, text: "" });
          } else {
            const block = display[cursor];
            if (block)
              setMode({
                type: "compose",
                kind: intent.kind,
                displayIndex: cursor,
                start: 0,
                end: displayText(block).length,
                text: "",
              });
          }
        }
        return;
      }
      case "openSubmit":
        if (!session) return;
        liveInput.current = "";
        // the confirm card lives in the expanded review rail; a compact or hidden
        // panel would swallow the whole submit flow, so force the rail open (live
        // only - the saved panel preference is left untouched)
        setReviewMode("expanded");
        setRailTab("review");
        return void setMode({ type: "submit", verdict: defaultVerdict(session), summary: "" });
      case "share":
        return controller.share();
      case "cut":
        return controller.cut(cursor);
      case "rejectHunk":
        return controller.toggleRejectHunk(cursor);
      case "rejectChange":
        return controller.toggleRejectChange(cursor);
      case "restoreCuration": {
        // undo the selected curated-out item, or the last rejected when none is
        // selected, so a bare `u` reads as "undo my last curation"
        const items = controller.curationItems();
        if (!items.length) return;
        const targetId = selectedCurationId ?? items[items.length - 1]!.id;
        controller.restoreCuration(targetId);
        return void setSelectedCurationId(undefined);
      }
      case "edit":
        return runEditorHandOff();
      case "editCard":
        if (focusedAnnotationId) openCardEdit(focusedAnnotationId);
        return;
      case "nextAnnotation":
      case "prevAnnotation": {
        // cycle open cards only - addressed ones are out of the rail
        const annotations = (session?.annotations ?? []).filter(
          (annotation) => !isAddressed(annotation),
        );
        if (!annotations.length) return;
        const focusedIndex = annotations.findIndex(
          (annotation) => annotation.id === focusedAnnotationId,
        );
        const nextIndex =
          focusedIndex === -1
            ? 0
            : (focusedIndex + (intent.type === "nextAnnotation" ? 1 : -1) + annotations.length) %
              annotations.length;
        return void selectCardFromDocument(annotations[nextIndex]!.id);
      }
      case "walkStart":
        return controller.walkStart();
      case "walkForward":
        return controller.walkForward();
      case "walkBack":
        return controller.walkBack();
      case "walkLeave":
        return controller.walkLeave();
      case "removeAnnotation":
        if (focusedAnnotationId) {
          controller.removeAnnotation(focusedAnnotationId);
          setFocusedAnnotationId(undefined);
        }
        return;
      case "deselect":
        planSheetRef.current?.clearSelection();
        setFocusedAnnotationId(undefined);
        setPulsedAnnotationId(null);
        return;
      case "closeOverlay":
        return void setMode({ type: "normal" });
      case "saveCompose": {
        const body = liveInput.current.trim();
        if (mode.type === "railEdit") {
          if (session && body) controller.updateAnnotation(mode.id, body);
          return void setMode({ type: "normal" });
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
          if (annotationId) setFocusedAnnotationId(annotationId);
        }
        return void setMode({ type: "normal" });
      }
      case "submitVerdict":
        if (mode.type === "submit") controller.submit(mode.verdict, liveInput.current);
        return void setMode({ type: "normal" });
      case "cycleVerdict": {
        if (mode.type !== "submit") return;
        const verdictIndex =
          (VERDICTS.indexOf(mode.verdict) + intent.direction + VERDICTS.length) % VERDICTS.length;
        return void setMode({ ...mode, verdict: VERDICTS[verdictIndex]! });
      }
      case "finishReview":
        return controller.finishReview();
      case "optInAutoClose":
        return controller.optInAutoClose();
      case "dismissCompletion":
        return controller.dismissCompletion();
      case "cycleReviewPanel": {
        const next = cycleReviewPanelMode(reviewMode);
        setReviewMode(next);
        return controller.saveReviewPanel({ mode: next });
      }
      case "resizeReviewPanel": {
        if (reviewMode !== "expanded") return;
        const next = resolveReviewWidth(
          reviewWidth + intent.direction * REVIEW_RESIZE_STEP,
          terminalWidth,
        );
        reviewWidthRef.current = next;
        setReviewWidth(next);
        return controller.saveReviewPanel({ width: next });
      }
    }
  };
}
