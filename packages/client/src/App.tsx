/**
 * The cueloop TUI: state wiring, keymap dispatch, and layout composition -
 * nothing else. Rendering lives in components/, daemon IO and the mutation
 * verbs in session-controller.ts, the keyboard grammar in keymap.ts with
 * binding resolution and status hints from key-bindings.ts, and theming in
 * the ThemeProvider. Selection is the entry primitive (mouse drag or keyboard
 * span on one native renderer selection); annotation text lives in the rail
 * while the document keeps only the highlight, and one selected id drives
 * both sides.
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { Clock, MouseEvent } from "@opentui/core";
import { isAgentNote, type ReviewSession, type VerdictKind } from "@cueloop/schema";
import { displayText, marksByDisplay, spanKey, startSpan, type Mark, type SpanState } from "./view-plan";
import { noteForFile, viewedCount } from "./walk";
import { DARK, dimmedTheme } from "./theme";
import { DEFAULT_KEYS, loadConfig } from "./config";
import { returnPaneFor } from "@cueloop/schema";
import { createReviewController } from "./session-controller";
import { reduceKey, type Intent, type KeyState } from "./keymap";
import { KeyBindings, type HintMode } from "./key-bindings";
import { ThemeProvider } from "./components/theme-context";
import { StatusBar } from "./components/primitives/StatusBar";
import { Breadcrumb, type BreadcrumbItem } from "./components/Breadcrumb";
import { PlanSheet, type PlanSheetHandle } from "./components/PlanSheet";
import { DiffSheet } from "./components/DiffSheet";
import { annotationBlocking, type ReviewRailHandle } from "./components/ReviewRail";
import { ReviewPanel } from "./components/ReviewPanel";
import {
  REVIEW_DEFAULT_WIDTH,
  REVIEW_RESIZE_STEP,
  clampWidth,
  cycleReviewPanelMode,
  toggleReviewPanelMode,
  widthFromMouseColumn,
  type ReviewPanelMode,
} from "./review-panel";
import { VERDICTS } from "./components/ConfirmCard";
import { CompletionOverlay } from "./components/CompletionOverlay";
import { InboxList } from "./components/InboxList";
import { ComposeBar } from "./components/ComposeBar";
import { WalkWizard } from "./components/WalkWizard";

/**
 * The breadcrumb header and the status bar each occupy one terminal row; the
 * review layout (plan column, divider, rail) gets the rows that remain.
 */
const CHROME_ROWS = 2;

export interface AppProps {
  home?: string;
  sessionId?: string;
  /**
   * Observer mode (SSH-served connections): every mutating verb is ignored and
   * answers "observer - read-only" in the status line; navigation still works.
   */
  readOnly?: boolean;
  onExit?: (code: number) => void;
  /** Timer source for the auto-close countdown; tests inject a ManualClock. */
  clock?: Clock;
}

type Mode =
  | { type: "normal" }
  | { type: "span"; span: SpanState }
  | { type: "compose"; kind: "comment" | "suggestion"; displayIndex: number; start: number; end: number; text: string }
  | { type: "railEdit"; id: string; text: string }
  | { type: "submit"; verdict: VerdictKind; summary: string };

/** Reviewer-authored annotations only: agent notes never count as feedback. */
function reviewerAnnotations(session: ReviewSession) {
  return session.annotations.filter((annotation) => !isAgentNote(annotation));
}

function defaultVerdict(session: ReviewSession): VerdictKind {
  return reviewerAnnotations(session).length || session.workingCopy !== undefined ? "request_changes" : "approve";
}

export function App({ home, sessionId, readOnly = false, onExit, clock }: AppProps): React.ReactNode {
  const controller = useMemo(
    () => createReviewController({ home, sessionId, readOnly, onExit, clock }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, sessionId],
  );
  useEffect(() => {
    controller.connect();
    return () => controller.close();
  }, [controller]);
  const { session, inbox, status, error, completion, editOrphanCount, walk } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const renderer = useRenderer();
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions();

  // ── view state ──────────────────────────────
  const [cursor, setCursor] = useState(0);
  const [inboxCursor, setInboxCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ type: "normal" });
  const [focusedAnnotationId, setFocusedAnnotationId] = useState<string | undefined>(undefined);
  const [railTab, setRailTab] = useState<"review" | "agent">("review");
  // review panel layout: mode + expanded width are client view state, loaded
  // from and persisted to the user config so they survive a restart. The ref
  // mirrors the width so the drag-end persist reads the latest value.
  const [reviewMode, setReviewMode] = useState<ReviewPanelMode>("expanded");
  const [reviewWidth, setReviewWidth] = useState(REVIEW_DEFAULT_WIDTH);
  const [dividerDragging, setDividerDragging] = useState(false);
  const reviewWidthRef = useRef(REVIEW_DEFAULT_WIDTH);
  // ~2s focus pulse on the document highlight when a rail card is activated
  const [pulsedAnnotationId, setPulsedAnnotationId] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // live mirror of overlay input text: refs commit synchronously, so the
  // RETURN handler never reads a stale value mid-typing
  const liveInput = useRef("");
  const planSheetRef = useRef<PlanSheetHandle | null>(null);
  const railRef = useRef<ReviewRailHandle | null>(null);
  // keymap from layered config; the loaded theme swaps the provider value
  const keysRef = useRef(DEFAULT_KEYS);
  const keyBindings = useMemo(() => new KeyBindings(DEFAULT_KEYS), []);
  const [theme, setTheme] = useState(DARK);
  useEffect(() => {
    const config = loadConfig({ repoRoot: session?.workspace.repoRoot });
    keysRef.current = config.keys;
    keyBindings.setKeys(config.keys);
    setTheme(config.theme);
    setReviewMode(config.ui.reviewState);
    setReviewWidth(config.ui.reviewWidth);
    reviewWidthRef.current = config.ui.reviewWidth;
    controller.applyConfig(config);
  }, [session?.workspace.repoRoot, controller, keyBindings]);
  useEffect(
    () => () => {
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
    },
    [],
  );

  // ── derived view model ──────────────────────
  const display = controller.display();
  const rows = controller.rows();
  const marks = useMemo(
    () => (session ? marksByDisplay(session.annotations, display, pulsedAnnotationId ?? undefined) : new Map<number, Mark[]>()),
    [session, display, pulsedAnnotationId],
  );
  /** Annotation ids whose anchor resolved against the working copy. */
  const resolvedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const blockMarks of marks.values()) {
      for (const mark of blockMarks) if (mark.annotationId) ids.add(mark.annotationId);
    }
    return ids;
  }, [marks]);
  const resolved = session?.status === "resolved";
  const isDiff = session?.artifact.type === "diff";

  // ── the guided walk's view model ────────────
  const walkFileList = controller.files();
  const walking = isDiff && walk !== null;
  const viewedPaths = useMemo(() => new Set(session?.viewedPaths ?? []), [session]);

  // driving needs committed layout, so it runs after render; any transition
  // out of span mode clears the renderer selection (compose paints its own
  // mark, and a mouse drag never changes the mode, so it survives)
  useEffect(() => {
    if (mode.type === "span") planSheetRef.current?.driveSpanSelection(mode.span);
    else planSheetRef.current?.clearSelection();
  }, [mode]);

  // ── selection symmetry: one selected id, both sides ──
  const pulse = (id: string): void => {
    setPulsedAnnotationId(id);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulsedAnnotationId(null), 2000);
  };

  /** Card activation scrolls the document to the anchor and pulses it. */
  const revealAnchor = (annotationId: string): void => {
    for (const [displayIndex, blockMarks] of marks) {
      if (!blockMarks.some((mark) => mark.annotationId === annotationId)) continue;
      setCursor(displayIndex);
      planSheetRef.current?.revealBlock(displayIndex);
      return;
    }
  };

  const selectCardFromDocument = (annotationId: string): void => {
    setFocusedAnnotationId(annotationId);
    railRef.current?.revealCard(annotationId);
  };

  const selectCardFromRail = (annotationId: string): void => {
    setFocusedAnnotationId(annotationId);
    pulse(annotationId);
    revealAnchor(annotationId);
  };

  const openCardEdit = (annotationId: string): void => {
    if (readOnly) return controller.setStatus("observer - read-only");
    if (resolved) return controller.setStatus("review submitted - read-only");
    const annotation = session?.annotations.find((candidate) => candidate.id === annotationId);
    if (!annotation) return;
    liveInput.current = annotation.body;
    setMode({ type: "railEdit", id: annotation.id, text: annotation.body });
  };

  /** The $EDITOR hand-off releases the terminal: suspend, edit, resume. */
  const runEditorHandOff = (): void => {
    renderer?.suspend();
    try {
      controller.edit();
    } finally {
      renderer?.resume();
    }
  };

  // ── keyboard grammar: build state, reduce, dispatch ──
  const dispatch = (intent: Intent): void => {
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
        setInboxCursor((current) => (intent.to === "down" ? Math.min(navigableCount - 1, current + 1) : Math.max(0, current - 1)));
        return;
      }
      case "openSession": {
        const selected = inbox?.[inboxCursor];
        if (selected) controller.open(selected.id);
        return;
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
          const span = spanKey(mode.span, intent.name, displayText(display[mode.span.displayIndex]!));
          setMode({ type: "span", span });
        }
        return;
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
          if (row) setMode({ type: "compose", kind: intent.kind, displayIndex: cursor, start: 0, end: row.text.length, text: "" });
        } else {
          // a mouse drag leaves a native selection; it wins over the cursor block
          const native = planSheetRef.current?.readSelection() ?? null;
          if (native) {
            setMode({ type: "compose", kind: intent.kind, ...native, text: "" });
          } else {
            const block = display[cursor];
            if (block) setMode({ type: "compose", kind: intent.kind, displayIndex: cursor, start: 0, end: displayText(block).length, text: "" });
          }
        }
        return;
      }
      case "openSubmit":
        if (!session) return;
        liveInput.current = "";
        // the confirm card lives in the review tab; opening submit reveals it
        setRailTab("review");
        return void setMode({ type: "submit", verdict: defaultVerdict(session), summary: "" });
      case "cut":
        return controller.cut(cursor);
      case "edit":
        return runEditorHandOff();
      case "editCard":
        if (focusedAnnotationId) openCardEdit(focusedAnnotationId);
        return;
      case "nextAnnotation":
      case "prevAnnotation": {
        const annotations = session?.annotations ?? [];
        if (!annotations.length) return;
        const focusedIndex = annotations.findIndex((annotation) => annotation.id === focusedAnnotationId);
        const nextIndex =
          focusedIndex === -1
            ? 0
            : (focusedIndex + (intent.type === "nextAnnotation" ? 1 : -1) + annotations.length) % annotations.length;
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
          const annotationId = controller.annotate(mode.kind, mode.displayIndex, mode.start, mode.end, body);
          if (annotationId) setFocusedAnnotationId(annotationId);
        }
        return void setMode({ type: "normal" });
      }
      case "submitVerdict":
        if (mode.type === "submit") controller.submit(mode.verdict, liveInput.current);
        return void setMode({ type: "normal" });
      case "cycleVerdict": {
        if (mode.type !== "submit") return;
        const verdictIndex = (VERDICTS.indexOf(mode.verdict) + intent.direction + VERDICTS.length) % VERDICTS.length;
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
        const next = clampWidth(reviewWidth + intent.direction * REVIEW_RESIZE_STEP);
        reviewWidthRef.current = next;
        setReviewWidth(next);
        return controller.saveReviewPanel({ width: next });
      }
    }
  };

  const overlay: KeyState["overlay"] =
    mode.type === "compose" || mode.type === "railEdit"
      ? "compose"
      : mode.type === "submit"
        ? "submit"
        : completion.phase === "prompt"
          ? "completion-prompt"
          : completion.phase === "counting"
            ? "completion-counting"
            : walking
              ? "walk"
              : "none";

  useKeyboard((key) => {
    const state: KeyState = {
      keys: keysRef.current,
      readOnly,
      overlay,
      view: !session ? "inbox" : isDiff ? "diff" : "plan",
      spanMode: mode.type === "span",
      resolved: !!resolved,
      hasInboxItems: !!inbox?.length,
      annotationCount: session?.annotations.length ?? 0,
      hasFocusedAnnotation: focusedAnnotationId !== undefined,
      walkAtEnd: walk !== null && walk.index >= walkFileList.length,
      cursorAnnotatable: isDiff
        ? rows[cursor] !== undefined && rows[cursor]!.kind !== "file" && rows[cursor]!.kind !== "hunk"
        : !!display[cursor]?.work,
    };
    keyBindings.setContext({ overlay: state.overlay, spanMode: state.spanMode });
    const action = keyBindings.resolveAction({ name: key.name, shift: !!key.shift });
    for (const intent of reduceKey(state, { name: key.name, shift: !!key.shift, meta: !!key.meta }, action))
      dispatch(intent);
  });

  // ── render ──────────────────────────────────
  if (error) {
    return (
      <ThemeProvider theme={theme}>
        <text fg={theme.red}>cueloop: {error}</text>
      </ThemeProvider>
    );
  }
  if (!session && !inbox) {
    return (
      <ThemeProvider theme={theme}>
        <text fg={theme.textDim}>connecting to the daemon…</text>
      </ThemeProvider>
    );
  }
  if (!session && inbox) {
    return (
      <ThemeProvider theme={theme}>
        <InboxList inbox={inbox} cursor={inboxCursor} />
      </ThemeProvider>
    );
  }

  const activeSession = session!;
  const pendingCount = reviewerAnnotations(activeSession).length + (activeSession.workingCopy !== undefined ? 1 : 0);

  if ((completion.phase === "prompt" || completion.phase === "counting") && activeSession.verdict) {
    return (
      <ThemeProvider theme={theme}>
        <CompletionOverlay
          verdict={activeSession.verdict.kind}
          completion={completion}
          status={status}
          returnsTo={returnPaneFor(activeSession.artifact.meta.herdrPane) ? (activeSession.artifact.meta.agent ?? "the agent") : undefined}
        />
      </ThemeProvider>
    );
  }

  const composeState =
    mode.type === "compose" && !isDiff
      ? {
          kind: mode.kind,
          displayIndex: mode.displayIndex,
          quote: displayText(display[mode.displayIndex]!).slice(mode.start, mode.end),
          draft: {
            text: mode.text,
            onInput: (text: string) => {
              liveInput.current = text;
              setMode({ ...mode, text });
            },
            onSave: () => dispatch({ type: "saveCompose" }),
            onCancel: () => dispatch({ type: "closeOverlay" }),
          },
        }
      : null;

  const activeSpan =
    mode.type === "span"
      ? { displayIndex: mode.span.displayIndex, start: mode.span.start, end: mode.span.end }
      : mode.type === "compose" && !isDiff
        ? // the compose anchor stays painted selection-style while the box is open
          { displayIndex: mode.displayIndex, start: mode.start, end: mode.end }
        : null;

  const onLineActivate = (displayIndex: number): void => {
    // releasing a drag-selection lands here too; a live selection is not a click
    if (renderer?.hasSelection) return;
    setCursor(displayIndex);
    const annotationId = marks.get(displayIndex)?.[0]?.annotationId;
    if (annotationId) selectCardFromDocument(annotationId);
  };

  const onEditRequest = (): void => {
    if (readOnly) return controller.setStatus("observer - read-only");
    if (resolved) return controller.setStatus("review submitted - read-only");
    runEditorHandOff();
  };

  // clicking the rail Submit button: same read-only answer as the submit key
  const onSubmitRequest = (): void => {
    if (readOnly) return controller.setStatus("observer - read-only");
    if (resolved) return;
    dispatch({ type: "openSubmit" });
  };

  // the clickable chevron toggles expanded <-> compact; the keybinding (b)
  // cycles all three including hidden
  const onToggleReviewPanel = (): void => {
    const next = toggleReviewPanelMode(reviewMode);
    setReviewMode(next);
    controller.saveReviewPanel({ mode: next });
  };
  // grabbing the divider only arms a drag when there is a width to drag
  const onDividerGrab = (): void => {
    if (reviewMode === "expanded") setDividerDragging(true);
  };

  const submitConfirmState =
    mode.type === "submit"
      ? {
          verdict: mode.verdict,
          summary: mode.summary,
          annotationCount: reviewerAnnotations(activeSession).length,
          blockingCount: reviewerAnnotations(activeSession).filter(annotationBlocking).length,
          // walk coverage keeps partial passes honest at the verdict
          viewedSummary:
            isDiff && activeSession.viewedPaths !== undefined
              ? `${viewedCount(walkFileList, viewedPaths)}/${walkFileList.length} files viewed`
              : undefined,
          onInput: (summary: string) => {
            liveInput.current = summary;
            setMode({ ...mode, summary });
          },
          onSelectVerdict: (verdict: VerdictKind) => setMode({ ...mode, verdict }),
          onSubmit: () => dispatch({ type: "submitVerdict" }),
          onCancel: () => dispatch({ type: "closeOverlay" }),
        }
      : null;

  const cardEditState =
    mode.type === "railEdit"
      ? {
          id: mode.id,
          text: mode.text,
          onInput: (text: string) => {
            liveInput.current = text;
            setMode({ type: "railEdit", id: mode.id, text });
          },
          onSave: () => dispatch({ type: "saveCompose" }),
          onCancel: () => dispatch({ type: "closeOverlay" }),
        }
      : null;

  const headerItems: BreadcrumbItem[] = [
    { label: "cueloop", tone: "accent" },
    { label: `${activeSession.artifact.meta.title ?? activeSession.artifact.meta.planPath ?? activeSession.id} · rev ${activeSession.revisions.length}`, tone: "dim" },
    ...(resolved ? [{ label: `resolved: ${activeSession.verdict!.kind.replace("_", " ")}`, tone: "green" as const }] : []),
    ...(readOnly ? [{ label: "observer", tone: "dim" as const }] : []),
    ...(status ? [{ label: status, tone: "accent" as const }] : []),
  ];

  keyBindings.setContext({ overlay, spanMode: mode.type === "span" });
  const hintMode: HintMode = readOnly
    ? "read-only"
    : mode.type === "submit"
      ? "submit"
      : mode.type === "span"
        ? "span"
        : mode.type === "compose" || mode.type === "railEdit"
          ? "compose"
          : walking
            ? "walk"
            : focusedAnnotationId !== undefined
              ? "card"
              : "normal";

  return (
    <ThemeProvider theme={theme}>
      <box
        style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: theme.bg }}
        onMouseDrag={(event: MouseEvent) => {
          if (!dividerDragging || reviewMode !== "expanded") return;
          const next = widthFromMouseColumn(event.x, terminalWidth);
          reviewWidthRef.current = next;
          setReviewWidth(next);
        }}
        onMouseUp={() => {
          if (!dividerDragging) return;
          setDividerDragging(false);
          controller.saveReviewPanel({ width: reviewWidthRef.current });
        }}
      >
        <Breadcrumb items={headerItems} />
        <box style={{ flexGrow: 1, flexDirection: "row" }}>
          {isDiff ? (
            // the sheet dims to reading-quiet colors while the wizard has focus
            <DiffSheet
              rows={rows}
              cursor={cursor}
              annotations={activeSession.annotations}
              focusedAnnotationId={focusedAnnotationId}
              theme={walking ? dimmedTheme(theme) : undefined}
            />
          ) : (
            <PlanSheet
              ref={planSheetRef}
              session={activeSession}
              display={display}
              marks={marks}
              cursor={cursor}
              activeSpan={activeSpan}
              compose={composeState}
              editOrphanCount={editOrphanCount}
              onLineActivate={onLineActivate}
              onEditRequest={onEditRequest}
            />
          )}
          <ReviewPanel
            mode={reviewMode}
            width={reviewWidth}
            height={terminalHeight - CHROME_ROWS}
            dragging={dividerDragging}
            onDividerGrab={onDividerGrab}
            onToggle={onToggleReviewPanel}
            railRef={railRef}
            rail={{
              session: activeSession,
              selectedId: focusedAnnotationId,
              resolvedIds: isDiff ? null : resolvedIds,
              railTab,
              pendingCount,
              cardEdit: cardEditState,
              submitConfirm: submitConfirmState,
              onTabChange: setRailTab,
              onSelectCard: selectCardFromRail,
              onActivateCard: openCardEdit,
              onSubmitRequest,
            }}
          />
        </box>
        {mode.type === "compose" && isDiff ? (
          <ComposeBar
            kind={mode.kind}
            quote={rows[mode.displayIndex]?.text ?? ""}
            text={mode.text}
            onInput={(text) => {
              liveInput.current = text;
              setMode({ ...mode, text });
            }}
          />
        ) : (
          <StatusBar>{keyBindings.statusHint(hintMode)}</StatusBar>
        )}
        {walking && walk !== null ? (
          <WalkWizard
            files={walkFileList}
            index={walk.index}
            viewedPaths={viewedPaths}
            note={
              walkFileList[walk.index] !== undefined
                ? noteForFile(activeSession.annotations, walkFileList[walk.index]!.path)
                : undefined
            }
            terminalWidth={terminalWidth}
            onSubmitRequest={() => {
              dispatch({ type: "walkLeave" });
              dispatch({ type: "openSubmit" });
            }}
            onBack={() => dispatch({ type: "walkBack" })}
          />
        ) : null}
      </box>
    </ThemeProvider>
  );
}
