/**
 * The cueloop TUI (#22, #71, #86): state wiring, keymap dispatch, and layout
 * composition - nothing else. Rendering lives in components/ (PlanSheet,
 * DiffSheet, ReviewRail, ...), daemon IO and the mutation verbs live in
 * session-controller.ts, the keyboard grammar in keymap.ts with binding
 * resolution and status hints from key-bindings.ts, and theming flows
 * through the ThemeProvider - config themes swap the provider value.
 *
 * The plan review grammar: selection is the entry primitive (mouse drag or
 * keyboard span on one native renderer selection), compose happens inline
 * under the anchor, annotation text lives in the rail while the document
 * keeps only the kind-colored highlight, and the rail edits what the
 * document selects - one selected id drives both sides.
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import type { Clock } from "@opentui/core";
import { isAgentNote, type ReviewSession, type VerdictKind } from "@cueloop/schema";
import { displayText, marksByDisplay, spanKey, startSpan, type Mark, type SpanState } from "./view";
import { noteForFile, viewedCount } from "./walk";
import { DARK, dimmedTheme } from "./theme";
import { DEFAULT_KEYS, loadConfig } from "./config";
import { returnPaneFor } from "./herdr";
import { createReviewController } from "./session-controller";
import { reduceKey, type Intent, type KeyState } from "./keymap";
import { KeyBindings, type HintMode } from "./key-bindings";
import { ThemeProvider } from "./components/theme-context";
import { StatusBar } from "./components/primitives/StatusBar";
import { Breadcrumb, type BreadcrumbItem } from "./components/Breadcrumb";
import { PlanSheet, type PlanSheetHandle } from "./components/PlanSheet";
import { DiffSheet } from "./components/DiffSheet";
import { ReviewRail, annotationBlocking, type ReviewRailHandle } from "./components/ReviewRail";
import { VERDICTS } from "./components/ConfirmCard";
import { CompletionOverlay } from "./components/CompletionOverlay";
import { InboxList } from "./components/InboxList";
import { ComposeBar } from "./components/ComposeBar";
import { WalkWizard } from "./components/WalkWizard";

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
  | { m: "normal" }
  | { m: "span"; span: SpanState }
  | { m: "compose"; kind: "comment" | "suggestion"; dispIdx: number; start: number; end: number; text: string }
  | { m: "railEdit"; id: string; text: string }
  | { m: "submit"; verdict: VerdictKind; summary: string };

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
  const { width: terminalWidth } = useTerminalDimensions();

  // ── view state ──────────────────────────────
  const [cursor, setCursor] = useState(0);
  const [inboxCursor, setInboxCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ m: "normal" });
  const [focusedAnn, setFocusedAnn] = useState<string | undefined>(undefined);
  const [railTab, setRailTab] = useState<"review" | "agent">("review");
  // ~2s focus pulse on the document highlight when a rail card is activated
  const [pulseAnn, setPulseAnn] = useState<string | null>(null);
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
    const cfg = loadConfig({ repoRoot: session?.workspace.repoRoot });
    keysRef.current = cfg.keys;
    keyBindings.setKeys(cfg.keys);
    setTheme(cfg.theme);
    controller.applyConfig(cfg);
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
    () => (session ? marksByDisplay(session.annotations, display, pulseAnn ?? undefined) : new Map<number, Mark[]>()),
    [session, display, pulseAnn],
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
    if (mode.m === "span") planSheetRef.current?.driveSpanSelection(mode.span);
    else planSheetRef.current?.clearSelection();
  }, [mode]);

  // ── selection symmetry: one selected id, both sides ──
  const pulse = (id: string): void => {
    setPulseAnn(id);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulseAnn(null), 2000);
  };

  /** Card activation scrolls the document to the anchor and pulses it. */
  const revealAnchor = (annotationId: string): void => {
    for (const [dispIdx, blockMarks] of marks) {
      if (!blockMarks.some((mark) => mark.annotationId === annotationId)) continue;
      setCursor(dispIdx);
      planSheetRef.current?.revealBlock(dispIdx);
      return;
    }
  };

  const selectCardFromDocument = (annotationId: string): void => {
    setFocusedAnn(annotationId);
    railRef.current?.revealCard(annotationId);
  };

  const selectCardFromRail = (annotationId: string): void => {
    setFocusedAnn(annotationId);
    pulse(annotationId);
    revealAnchor(annotationId);
  };

  const openCardEdit = (annotationId: string): void => {
    if (readOnly) return controller.setStatus("observer - read-only");
    if (resolved) return controller.setStatus("review submitted - read-only");
    const annotation = session?.annotations.find((candidate) => candidate.id === annotationId);
    if (!annotation) return;
    liveInput.current = annotation.body;
    setMode({ m: "railEdit", id: annotation.id, text: annotation.body });
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
    switch (intent.t) {
      case "exit":
        return void onExit?.(0);
      case "status":
        return controller.setStatus(intent.msg);
      case "move": {
        const len = isDiff ? rows.length : display.length;
        if (intent.to === "down") setCursor((c) => Math.min(len - 1, c + 1));
        else if (intent.to === "up") setCursor((c) => Math.max(0, c - 1));
        else if (intent.to === "top") setCursor(0);
        else setCursor(len - 1);
        return;
      }
      case "inboxMove": {
        const len = inbox?.length ?? 0;
        setInboxCursor((c) => (intent.to === "down" ? Math.min(len - 1, c + 1) : Math.max(0, c - 1)));
        return;
      }
      case "openSession": {
        const s = inbox?.[inboxCursor];
        if (s) controller.open(s.id);
        return;
      }
      case "startSpan": {
        const d = display[cursor];
        if (!d?.work) return;
        const span = startSpan(cursor, displayText(d));
        if (span) setMode({ m: "span", span });
        return;
      }
      case "spanKey":
        if (mode.m === "span") {
          const span = spanKey(mode.span, intent.name, displayText(display[mode.span.dispIdx]!));
          setMode({ m: "span", span });
        }
        return;
      case "openCompose": {
        liveInput.current = "";
        if (intent.from === "span" && mode.m === "span") {
          setMode({
            m: "compose",
            kind: intent.kind,
            dispIdx: mode.span.dispIdx,
            start: mode.span.start,
            end: mode.span.end,
            text: "",
          });
        } else if (isDiff) {
          const row = rows[cursor];
          if (row) setMode({ m: "compose", kind: intent.kind, dispIdx: cursor, start: 0, end: row.text.length, text: "" });
        } else {
          // a mouse drag leaves a native selection; it wins over the cursor block
          const native = planSheetRef.current?.readSelection() ?? null;
          if (native) {
            setMode({ m: "compose", kind: intent.kind, ...native, text: "" });
          } else {
            const d = display[cursor];
            if (d) setMode({ m: "compose", kind: intent.kind, dispIdx: cursor, start: 0, end: displayText(d).length, text: "" });
          }
        }
        return;
      }
      case "openSubmit":
        if (!session) return;
        liveInput.current = "";
        // the confirm card lives in the review tab; opening submit reveals it
        setRailTab("review");
        return void setMode({ m: "submit", verdict: defaultVerdict(session), summary: "" });
      case "cut":
        return controller.cut(cursor);
      case "edit":
        return runEditorHandOff();
      case "editCard":
        if (focusedAnn) openCardEdit(focusedAnn);
        return;
      case "nextAnn":
      case "prevAnn": {
        const anns = session?.annotations ?? [];
        if (!anns.length) return;
        const idx = anns.findIndex((a) => a.id === focusedAnn);
        const next = idx === -1 ? 0 : (idx + (intent.t === "nextAnn" ? 1 : -1) + anns.length) % anns.length;
        return void selectCardFromDocument(anns[next]!.id);
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
        if (focusedAnn) {
          controller.removeAnnotation(focusedAnn);
          setFocusedAnn(undefined);
        }
        return;
      case "deselect":
        planSheetRef.current?.clearSelection();
        setFocusedAnn(undefined);
        setPulseAnn(null);
        return;
      case "closeOverlay":
        return void setMode({ m: "normal" });
      case "saveCompose": {
        const body = liveInput.current.trim();
        if (mode.m === "railEdit") {
          if (session && body) controller.updateAnnotation(mode.id, body);
          return void setMode({ m: "normal" });
        }
        if (mode.m !== "compose") return;
        if (session && body) {
          const annotationId = controller.annotate(mode.kind, mode.dispIdx, mode.start, mode.end, body);
          if (annotationId) setFocusedAnn(annotationId);
        }
        return void setMode({ m: "normal" });
      }
      case "submitVerdict":
        if (mode.m === "submit") controller.submit(mode.verdict, liveInput.current);
        return void setMode({ m: "normal" });
      case "cycleVerdict": {
        if (mode.m !== "submit") return;
        const idx = (VERDICTS.indexOf(mode.verdict) + intent.dir + VERDICTS.length) % VERDICTS.length;
        return void setMode({ ...mode, verdict: VERDICTS[idx]! });
      }
      case "finishReview":
        return controller.finishReview();
      case "optInAutoClose":
        return controller.optInAutoClose();
      case "dismissCompletion":
        return controller.dismissCompletion();
    }
  };

  const overlay: KeyState["overlay"] =
    mode.m === "compose" || mode.m === "railEdit"
      ? "compose"
      : mode.m === "submit"
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
      spanMode: mode.m === "span",
      resolved: !!resolved,
      hasInboxItems: !!inbox?.length,
      annotationCount: session?.annotations.length ?? 0,
      hasFocusedAnnotation: focusedAnn !== undefined,
      walkAtEnd: walk !== null && walk.index >= walkFileList.length,
      cursorAnnotatable: isDiff
        ? rows[cursor] !== undefined && rows[cursor]!.t !== "file" && rows[cursor]!.t !== "hunk"
        : !!display[cursor]?.work,
    };
    keyBindings.setContext({ overlay: state.overlay, spanMode: state.spanMode });
    const action = keyBindings.resolveAction({ name: key.name, shift: !!key.shift });
    for (const intent of reduceKey(state, { name: key.name, shift: !!key.shift }, action)) dispatch(intent);
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

  const s = session!;
  const pendingCount = reviewerAnnotations(s).length + (s.workingCopy !== undefined ? 1 : 0);

  if ((completion.phase === "prompt" || completion.phase === "counting") && s.verdict) {
    return (
      <ThemeProvider theme={theme}>
        <CompletionOverlay
          verdict={s.verdict.kind}
          completion={completion}
          status={status}
          returnsTo={returnPaneFor(s.artifact.meta.herdrPane) ? (s.artifact.meta.agent ?? "the agent") : undefined}
        />
      </ThemeProvider>
    );
  }

  const composeState =
    mode.m === "compose" && !isDiff
      ? {
          kind: mode.kind,
          dispIdx: mode.dispIdx,
          quote: displayText(display[mode.dispIdx]!).slice(mode.start, mode.end),
          draft: {
            text: mode.text,
            onInput: (text: string) => {
              liveInput.current = text;
              setMode({ ...mode, text });
            },
            onSave: () => dispatch({ t: "saveCompose" }),
            onCancel: () => dispatch({ t: "closeOverlay" }),
          },
        }
      : null;

  const activeSpan =
    mode.m === "span"
      ? { dispIdx: mode.span.dispIdx, start: mode.span.start, end: mode.span.end }
      : mode.m === "compose" && !isDiff
        ? // the compose anchor stays painted selection-style while the box is open
          { dispIdx: mode.dispIdx, start: mode.start, end: mode.end }
        : null;

  const onLineActivate = (dispIdx: number): void => {
    // releasing a drag-selection lands here too; a live selection is not a click
    if (renderer?.hasSelection) return;
    setCursor(dispIdx);
    const annotationId = marks.get(dispIdx)?.[0]?.annotationId;
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
    dispatch({ t: "openSubmit" });
  };

  const submitConfirmState =
    mode.m === "submit"
      ? {
          verdict: mode.verdict,
          summary: mode.summary,
          annotationCount: reviewerAnnotations(s).length,
          blockingCount: reviewerAnnotations(s).filter(annotationBlocking).length,
          // walk coverage keeps partial passes honest at the verdict
          viewedSummary:
            isDiff && s.viewedPaths !== undefined
              ? `${viewedCount(walkFileList, viewedPaths)}/${walkFileList.length} files viewed`
              : undefined,
          onInput: (summary: string) => {
            liveInput.current = summary;
            setMode({ ...mode, summary });
          },
          onSelectVerdict: (verdict: VerdictKind) => setMode({ ...mode, verdict }),
          onSubmit: () => dispatch({ t: "submitVerdict" }),
          onCancel: () => dispatch({ t: "closeOverlay" }),
        }
      : null;

  const cardEditState =
    mode.m === "railEdit"
      ? {
          id: mode.id,
          text: mode.text,
          onInput: (text: string) => {
            liveInput.current = text;
            setMode({ m: "railEdit", id: mode.id, text });
          },
          onSave: () => dispatch({ t: "saveCompose" }),
          onCancel: () => dispatch({ t: "closeOverlay" }),
        }
      : null;

  const headerItems: BreadcrumbItem[] = [
    { label: "cueloop", tone: "accent" },
    { label: `${s.artifact.meta.title ?? s.artifact.meta.planPath ?? s.id} · rev ${s.revisions.length}`, tone: "dim" },
    ...(resolved ? [{ label: `resolved: ${s.verdict!.kind.replace("_", " ")}`, tone: "green" as const }] : []),
    ...(readOnly ? [{ label: "observer", tone: "dim" as const }] : []),
    ...(status ? [{ label: status, tone: "accent" as const }] : []),
  ];

  keyBindings.setContext({ overlay, spanMode: mode.m === "span" });
  const hintMode: HintMode = readOnly
    ? "read-only"
    : mode.m === "submit"
      ? "submit"
      : mode.m === "span"
        ? "span"
        : mode.m === "compose" || mode.m === "railEdit"
          ? "compose"
          : walking
            ? "walk"
            : focusedAnn !== undefined
              ? "card"
              : "normal";
  const railWidth = terminalWidth >= 100 ? 34 : 28;

  return (
    <ThemeProvider theme={theme}>
      <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: theme.bg }}>
        <Breadcrumb items={headerItems} />
        <box style={{ flexGrow: 1, flexDirection: "row" }}>
          {isDiff ? (
            // the sheet dims to reading-quiet colors while the wizard has focus
            <DiffSheet
              rows={rows}
              cursor={cursor}
              annotations={s.annotations}
              focusedAnnotationId={focusedAnn}
              theme={walking ? dimmedTheme(theme) : undefined}
            />
          ) : (
            <PlanSheet
              ref={planSheetRef}
              session={s}
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
          <ReviewRail
            ref={railRef}
            session={s}
            selectedId={focusedAnn}
            resolvedIds={isDiff ? null : resolvedIds}
            railTab={railTab}
            pendingCount={pendingCount}
            cardEdit={cardEditState}
            submitConfirm={submitConfirmState}
            onTabChange={setRailTab}
            onSelectCard={selectCardFromRail}
            onActivateCard={openCardEdit}
            onSubmitRequest={onSubmitRequest}
            width={railWidth}
          />
        </box>
        {mode.m === "compose" && isDiff ? (
          <ComposeBar
            kind={mode.kind}
            quote={rows[mode.dispIdx]?.text ?? ""}
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
                ? noteForFile(s.annotations, walkFileList[walk.index]!.path)
                : undefined
            }
            terminalWidth={terminalWidth}
            onSubmitRequest={() => {
              dispatch({ t: "walkLeave" });
              dispatch({ t: "openSubmit" });
            }}
            onBack={() => dispatch({ t: "walkBack" })}
          />
        ) : null}
      </box>
    </ThemeProvider>
  );
}
