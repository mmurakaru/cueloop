/**
 * The cueloop TUI (#22, #71): header, plan sheet (sheet header + inline
 * compose + selectable lines) or diff pane, right review rail, footer hint
 * bar. Thin renderer over the review-session controller: daemon IO and the
 * mutation verbs live in session-controller.ts, the keyboard grammar in
 * keymap.ts; local state is view state only (cursor, selection, overlays).
 *
 * The plan review grammar: selection is the entry primitive (mouse drag or
 * keyboard span on one native renderer selection), compose happens inline
 * under the anchor, annotation text lives in the rail while the document
 * keeps only the kind-colored highlight, and the rail edits what the
 * document selects - one selected id drives both sides.
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import type { ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { type Annotation, type ReviewSession, type VerdictKind } from "@cueloop/schema";
import {
  blockRuns,
  composeBoxHeight,
  displayText,
  marksByDisplay,
  overlayMarks,
  revisionDelta,
  spanKey,
  startSpan,
  wrapRuns,
  type DisplayBlock,
  type Mark,
  type SpanState,
  type StyleRun,
} from "./view";
import { type DiffRow } from "./view-diff";
import { DARK as T } from "./theme";
import { highlightCode, type CodeToken } from "./syntax";
import { DEFAULT_KEYS, loadConfig } from "./config";
import { returnPaneFor } from "./herdr";
import { createReviewController } from "./session-controller";
import { reduceKey, type Intent, type KeyState } from "./keymap";

export interface AppProps {
  home?: string;
  sessionId?: string;
  /**
   * Observer mode (SSH-served connections): every mutating verb is ignored and
   * answers "observer - read-only" in the status line; navigation still works.
   */
  readOnly?: boolean;
  onExit?: (code: number) => void;
}

type Mode =
  | { m: "normal" }
  | { m: "span"; span: SpanState }
  | { m: "compose"; kind: "comment" | "suggestion"; dispIdx: number; start: number; end: number; text: string }
  | { m: "railEdit"; id: string; text: string }
  | { m: "submit"; verdict: VerdictKind; summary: string };

type RailTab = "review" | "agent";

const VERDICTS: VerdictKind[] = ["comment", "approve", "request_changes"];
/** Selector words in the rail confirm card - one word per verdict. */
const VERDICT_LABEL: Record<VerdictKind, string> = {
  comment: "Comment",
  approve: "Approve",
  request_changes: "Changes",
};

/** One rendered plan line, registered for the native selection primitive. */
interface PlanLineRef {
  renderable: TextRenderable;
  dispIdx: number;
  lineIndex: number;
  /** Block-text offset of the line's first positioned run; null for pure-del lines. */
  lineStart: number | null;
  /** Screen columns before the run text (cursor glyph + list marker). */
  prefixColumns: number;
  /** Length of the positioned run text in this line. */
  textLength: number;
}

/** Rail card height (3 text rows + 1 margin), for reveal-scroll math. */
const RAIL_CARD_HEIGHT = 4;

export function App({ home, sessionId, readOnly = false, onExit }: AppProps): React.ReactNode {
  const controller = useMemo(
    () => createReviewController({ home, sessionId, readOnly, onExit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, sessionId],
  );
  useEffect(() => {
    controller.connect();
    return () => controller.close();
  }, [controller]);
  const { session, inbox, status, error, completion, editOrphanCount } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const renderer = useRenderer();

  // ── view state ──────────────────────────────
  const [cursor, setCursor] = useState(0);
  const [inboxCursor, setInboxCursor] = useState(0);
  const [mode, setMode] = useState<Mode>({ m: "normal" });
  const [focusedAnn, setFocusedAnn] = useState<string | undefined>(undefined);
  const [railTab, setRailTab] = useState<RailTab>("review");
  // ~2s focus pulse on the document highlight when a rail card is activated
  const [pulseAnn, setPulseAnn] = useState<string | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // live mirror of overlay input text: refs commit synchronously, so the
  // RETURN handler never reads a stale value mid-typing
  const liveInput = useRef("");
  // rendered plan lines, for driving and reading the native selection
  const lineRefs = useRef(new Map<string, PlanLineRef>());
  const docScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const railScrollRef = useRef<ScrollBoxRenderable | null>(null);
  // keymap from layered config; theme overrides land on the shared tokens
  const keysRef = useRef(DEFAULT_KEYS);
  useEffect(() => {
    const cfg = loadConfig({ repoRoot: session?.workspace.repoRoot });
    keysRef.current = cfg.keys;
    Object.assign(T, cfg.theme);
    controller.applyConfig(cfg);
  }, [session?.workspace.repoRoot, controller]);
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

  // ── the native selection: keyboard driver ───
  const lineRefFor = (dispIdx: number, offset: number): PlanLineRef | null => {
    for (const meta of lineRefs.current.values()) {
      if (meta.dispIdx !== dispIdx || meta.lineStart === null) continue;
      if (offset >= meta.lineStart && offset < meta.lineStart + meta.textLength) return meta;
    }
    return null;
  };

  /** Anchor/extend the renderer's native selection from keyboard span offsets. */
  const driveNativeSelection = (span: SpanState): void => {
    if (!renderer) return;
    const startMeta = lineRefFor(span.dispIdx, span.start);
    const endMeta = lineRefFor(span.dispIdx, span.end - 1);
    if (!startMeta || !endMeta) return;
    const startColumn = startMeta.prefixColumns + (span.start - startMeta.lineStart!);
    const endColumn = endMeta.prefixColumns + (span.end - 1 - endMeta.lineStart!);
    renderer.startSelection(startMeta.renderable, startMeta.renderable.x + startColumn, startMeta.renderable.y);
    renderer.updateSelection(endMeta.renderable, endMeta.renderable.x + endColumn + 1, endMeta.renderable.y);
  };
  // driving needs committed layout, so it runs after render; any transition
  // out of span mode clears the renderer selection (compose paints its own
  // mark, and a mouse drag never changes the mode, so it survives)
  useEffect(() => {
    if (mode.m === "span") driveNativeSelection(mode.span);
    else renderer?.clearSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  /**
   * Read the native selection (mouse drag) back as a block range. The quote
   * anchors in the FIRST selected block - quote anchors resolve within one
   * block. Columns map 1:1 onto text offsets except inside word-diffed mod
   * blocks, where inline del runs shift the screen columns.
   */
  const readNativeSelection = (): { dispIdx: number; start: number; end: number } | null => {
    if (!renderer?.hasSelection) return null;
    const ordered = [...lineRefs.current.values()].sort(
      (a, b) => a.dispIdx - b.dispIdx || a.lineIndex - b.lineIndex,
    );
    let found: { dispIdx: number; start: number; end: number } | null = null;
    for (const meta of ordered) {
      if (meta.lineStart === null) continue;
      const selection = meta.renderable.getSelection();
      if (!selection || selection.end <= selection.start) continue;
      const startInText = Math.min(meta.textLength, Math.max(0, selection.start - meta.prefixColumns));
      const endInText = Math.min(meta.textLength, Math.max(0, selection.end - meta.prefixColumns));
      if (endInText <= startInText) continue;
      const blockStart = meta.lineStart + startInText;
      const blockEnd = meta.lineStart + endInText;
      if (!found) found = { dispIdx: meta.dispIdx, start: blockStart, end: blockEnd };
      else if (found.dispIdx === meta.dispIdx) found.end = Math.max(found.end, blockEnd);
    }
    return found;
  };

  // ── selection symmetry: one selected id, both sides ──
  const pulse = (id: string): void => {
    setPulseAnn(id);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => setPulseAnn(null), 2000);
  };

  const revealRailCard = (annotationId: string): void => {
    const index = session?.annotations.findIndex((annotation) => annotation.id === annotationId) ?? -1;
    if (index >= 0) railScrollRef.current?.scrollTo(Math.max(0, index * RAIL_CARD_HEIGHT - 1));
  };

  /** Card activation scrolls the document to the anchor and pulses it. */
  const revealAnchor = (annotationId: string): void => {
    for (const [dispIdx, blockMarks] of marks) {
      if (!blockMarks.some((mark) => mark.annotationId === annotationId)) continue;
      setCursor(dispIdx);
      try {
        docScrollRef.current?.scrollChildIntoView(`plan-block-${dispIdx}`);
      } catch {
        // reveal is best-effort; selection state is already correct
      }
      return;
    }
  };

  const selectCardFromDocument = (annotationId: string): void => {
    setFocusedAnn(annotationId);
    revealRailCard(annotationId);
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
          driveNativeSelection(span);
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
          const native = readNativeSelection();
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
        return controller.edit();
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
      case "removeAnnotation":
        if (focusedAnn) {
          controller.removeAnnotation(focusedAnn);
          setFocusedAnn(undefined);
        }
        return;
      case "deselect":
        renderer?.clearSelection();
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

  useKeyboard((key) => {
    const state: KeyState = {
      keys: keysRef.current,
      readOnly,
      overlay:
        mode.m === "compose" || mode.m === "railEdit"
          ? "compose"
          : mode.m === "submit"
            ? "submit"
            : completion.phase === "prompt"
              ? "completion-prompt"
              : completion.phase === "counting"
                ? "completion-counting"
                : "none",
      view: !session ? "inbox" : isDiff ? "diff" : "plan",
      spanMode: mode.m === "span",
      resolved: !!resolved,
      hasInboxItems: !!inbox?.length,
      annotationCount: session?.annotations.length ?? 0,
      hasFocusedAnnotation: focusedAnn !== undefined,
      cursorAnnotatable: isDiff
        ? rows[cursor] !== undefined && rows[cursor]!.t !== "file" && rows[cursor]!.t !== "hunk"
        : !!display[cursor]?.work,
    };
    for (const intent of reduceKey(state, { name: key.name, shift: !!key.shift })) dispatch(intent);
  });

  // ── render ──────────────────────────────────
  if (error) return <text fg={T.red}>cueloop: {error}</text>;
  if (!session && !inbox) return <text fg={T.textDim}>connecting to the daemon…</text>;
  if (!session && inbox) return <Inbox inbox={inbox} cursor={inboxCursor} />;

  const s = session!;
  const pendingCount = s.annotations.length + (s.workingCopy !== undefined ? 1 : 0);

  if ((completion.phase === "prompt" || completion.phase === "counting") && s.verdict) {
    return (
      <CompletionOverlay
        verdict={s.verdict.kind}
        completion={completion}
        status={status}
        returnsTo={returnPaneFor(s.artifact.meta.herdrPane) ? (s.artifact.meta.agent ?? "the agent") : undefined}
      />
    );
  }

  const composeState =
    mode.m === "compose" && !isDiff
      ? {
          kind: mode.kind,
          dispIdx: mode.dispIdx,
          quote: displayText(display[mode.dispIdx]!).slice(mode.start, mode.end),
          text: mode.text,
          onInput: (text: string) => {
            liveInput.current = text;
            setMode({ ...mode, text });
          },
          onSave: () => dispatch({ t: "saveCompose" }),
          onCancel: () => dispatch({ t: "closeOverlay" }),
        }
      : null;

  const registerLine = (key: string, renderable: TextRenderable | null, meta: Omit<PlanLineRef, "renderable">): void => {
    if (renderable) lineRefs.current.set(key, { renderable, ...meta });
    else lineRefs.current.delete(key);
  };

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
    controller.edit();
  };

  // clicking the rail Submit button: same read-only answer as the submit key
  const onSubmitRequest = (): void => {
    if (readOnly) return controller.setStatus("observer - read-only");
    if (resolved) return;
    dispatch({ t: "openSubmit" });
  };

  const submitConfirmState: SubmitConfirmState | null =
    mode.m === "submit"
      ? {
          verdict: mode.verdict,
          summary: mode.summary,
          annotationCount: s.annotations.length,
          blockingCount: s.annotations.filter(annotationBlocking).length,
          onInput: (summary: string) => {
            liveInput.current = summary;
            setMode({ ...mode, summary });
          },
          onSelectVerdict: (verdict: VerdictKind) => setMode({ ...mode, verdict }),
          onSubmit: () => dispatch({ t: "submitVerdict" }),
          onCancel: () => dispatch({ t: "closeOverlay" }),
        }
      : null;

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: T.bg }}>
      <box style={{ height: 1, backgroundColor: T.panel, paddingLeft: 1, flexDirection: "row" }}>
        <text fg={T.text}>
          <span fg={T.accent}>cueloop</span>
          <span fg={T.textDim}> · {s.artifact.meta.title ?? s.artifact.meta.planPath ?? s.id} · rev {s.revisions.length}</span>
          {resolved ? <span fg={T.green}> · resolved: {s.verdict!.kind.replace("_", " ")}</span> : null}
          {readOnly ? <span fg={T.textDim}> · observer</span> : null}
          {status ? <span fg={T.accent}> · {status}</span> : null}
        </text>
      </box>
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        {isDiff ? (
          <DiffPane rows={rows} cursor={cursor} annotations={s.annotations} focusedAnn={focusedAnn} />
        ) : (
          <PlanPane
            display={display}
            marks={marks}
            cursor={cursor}
            mode={mode}
            session={s}
            editOrphanCount={editOrphanCount}
            compose={composeState}
            registerLine={registerLine}
            onLineActivate={onLineActivate}
            onEditRequest={onEditRequest}
            docScrollRef={docScrollRef}
          />
        )}
        <Rail
          session={s}
          selectedId={focusedAnn}
          resolvedIds={isDiff ? null : resolvedIds}
          railTab={railTab}
          pendingCount={pendingCount}
          cardEdit={
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
              : null
          }
          submitConfirm={submitConfirmState}
          onTab={setRailTab}
          onSelectCard={selectCardFromRail}
          onActivateCard={openCardEdit}
          onSubmitRequest={onSubmitRequest}
          railScrollRef={railScrollRef}
        />
      </box>
      {mode.m === "compose" && isDiff ? (
        <ComposeBar mode={mode} quote={rows[mode.dispIdx]?.text ?? ""} onChange={(text) => { liveInput.current = text; setMode({ ...mode, text }); }} />
      ) : (
        <box style={{ height: 1, backgroundColor: T.panel, paddingLeft: 1 }}>
          <text fg={T.textDim}>
            {readOnly
              ? "observer - read-only · j/k move · n/p annotations · q quit"
              : mode.m === "submit"
                ? "verdict ←/→ · ⏎ submit · esc cancel"
                : mode.m === "span"
                  ? "span · l/h grow/shrink · w/b slide · $ end · c comment · s suggest · esc"
                  : mode.m === "compose" || mode.m === "railEdit"
                    ? "typing · ⏎ save · esc cancel"
                    : focusedAnn !== undefined
                      ? "card · e edit · x Cut · n/p cards · esc deselect · ⏎ submit"
                      : "j/k move · v span · drag selects · c comment · s suggest · x cut · e edit · n/p annotations · ⏎ submit · q quit"}
          </text>
        </box>
      )}
    </box>
  );
}

// ── panes ─────────────────────────────────────

interface ComposeState {
  kind: "comment" | "suggestion";
  dispIdx: number;
  quote: string;
  text: string;
  onInput: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function PlanPane({
  display,
  marks,
  cursor,
  mode,
  session,
  editOrphanCount,
  compose,
  registerLine,
  onLineActivate,
  onEditRequest,
  docScrollRef,
}: {
  display: DisplayBlock[];
  marks: Map<number, Mark[]>;
  cursor: number;
  mode: Mode;
  session: ReviewSession;
  editOrphanCount: number;
  compose: ComposeState | null;
  registerLine: (key: string, renderable: TextRenderable | null, meta: Omit<PlanLineRef, "renderable">) => void;
  onLineActivate: (dispIdx: number) => void;
  onEditRequest: () => void;
  docScrollRef: React.RefObject<ScrollBoxRenderable | null>;
}): React.ReactNode {
  const width = 76;
  const children: React.ReactNode[] = [];
  for (let i = 0; i < display.length; i++) {
    const d = display[i]!;
    const isCursor = i === cursor;
    const gap = topGap(display[i - 1], d);
    if (d.kind === "code") {
      children.push(
        <CodeBlock key={i} id={`plan-block-${i}`} block={d} isCursor={isCursor} gap={gap} annotated={(marks.get(i) ?? []).length > 0} />,
      );
    } else {
      const blockMarks = [...(marks.get(i) ?? [])];
      if (mode.m === "span" && mode.span.dispIdx === i) {
        blockMarks.push({ start: mode.span.start, end: mode.span.end, role: "kspan" });
      }
      // the compose anchor stays painted selection-style while the box is open
      if (mode.m === "compose" && mode.dispIdx === i) {
        blockMarks.push({ start: mode.start, end: mode.end, role: "kspan" });
      }
      const runs = overlayMarks(blockRuns(d, true), blockMarks);
      const lines = wrapRuns(runs, width - marker(d).length);
      const prefixColumns = 2 + marker(d).length;
      children.push(
        <box key={i} id={`plan-block-${i}`} style={{ flexDirection: "column", marginTop: gap }}>
          {lines.map((line, li) => {
            const positioned = line.filter((run) => run.start !== null);
            const lineStart = positioned.length ? positioned[0]!.start : null;
            const lastPositioned = positioned[positioned.length - 1];
            const textLength =
              lineStart !== null && lastPositioned ? lastPositioned.start! + lastPositioned.text.length - lineStart : 0;
            return (
              <text
                key={li}
                bg={isCursor ? T.cursorBg : undefined}
                selectable
                selectionBg={T.accent}
                selectionFg={T.accentInk}
                ref={(renderable: TextRenderable | null) =>
                  registerLine(`${i}:${li}`, renderable, { dispIdx: i, lineIndex: li, lineStart, prefixColumns, textLength })
                }
                onMouseUp={() => onLineActivate(i)}
              >
                <span fg={isCursor ? T.accent : T.textDim}>{li === 0 ? cursorGlyph(isCursor) : "  "}</span>
                <span fg={T.textDim}>{li === 0 ? marker(d) : " ".repeat(marker(d).length)}</span>
                {line.map((r, ri) => (
                  <span key={ri} {...runStyle(r, d)}>
                    {r.text}
                  </span>
                ))}
                {li === 0 && d.type !== "same" ? <span fg={tagColor(d)}> [{tagLabel(d)}]</span> : null}
              </text>
            );
          })}
        </box>,
      );
    }
    if (compose && compose.dispIdx === i) {
      children.push(
        <AnnotationCard
          key={`compose-${i}`}
          kind={compose.kind}
          quote={compose.quote}
          draft={{ text: compose.text, onInput: compose.onInput, onSave: compose.onSave, onCancel: compose.onCancel }}
        />,
      );
    }
  }
  return (
    <box style={{ flexGrow: 1, flexDirection: "column" }}>
      <SheetHeader session={session} onEditRequest={onEditRequest} />
      {editOrphanCount > 0 ? (
        <box style={{ height: 1, backgroundColor: T.markCommentBg, paddingLeft: 2 }}>
          <text fg={T.red}>
            {editOrphanCount} annotation{editOrphanCount === 1 ? "" : "s"} no longer match - the passage was removed.
          </text>
        </box>
      ) : null}
      <scrollbox ref={docScrollRef} style={{ flexGrow: 1, paddingLeft: 2, paddingTop: 1 }} focused={false}>
        {children}
      </scrollbox>
    </box>
  );
}

/** Sheet chrome: submitted-by + revision delta left, the Edit word-button right. */
function SheetHeader({ session, onEditRequest }: { session: ReviewSession; onEditRequest: () => void }): React.ReactNode {
  const revisionCount = session.revisions.length;
  const previous = revisionCount > 1 ? session.revisions[revisionCount - 2] : undefined;
  const delta = previous ? revisionDelta(previous.content, session.artifact.content) : null;
  return (
    <box style={{ height: 1, flexDirection: "row", paddingLeft: 2, paddingRight: 1 }}>
      <text fg={T.textDim}>
        submitted by <span fg={T.textMuted}>{session.artifact.meta.agent ?? "unknown"}</span> · revision {revisionCount}
        {delta ? (
          <span fg={T.green}>
            {" "}· v{revisionCount - 1}→v{revisionCount} +{delta.added} -{delta.removed}
          </span>
        ) : null}
      </text>
      <box style={{ flexGrow: 1 }} />
      <box onMouseUp={onEditRequest}>
        <text fg={T.textDim}> Edit </text>
      </box>
    </box>
  );
}

function CodeBlock({
  id,
  block,
  isCursor,
  gap,
  annotated,
}: {
  id: string;
  block: DisplayBlock;
  isCursor: boolean;
  gap: number;
  annotated: boolean;
}): React.ReactNode {
  const lang = (block.work ?? block.base)?.lang;
  const content = displayText(block);
  // Shiki tokens arrive async; plain verbatim lines render until then
  const [tokens, setTokens] = useState<CodeToken[][] | null>(null);
  useEffect(() => {
    let live = true;
    void highlightCode(content, lang).then((t) => {
      if (live && t) setTokens(t);
    });
    return () => {
      live = false;
    };
  }, [content, lang]);
  const lines: CodeToken[][] = tokens ?? content.split("\n").map((l) => [{ content: l }]);
  return (
    <box id={id} style={{ flexDirection: "column", marginTop: gap }}>
      <text>
        <span fg={isCursor ? T.accent : T.textDim}>{cursorGlyph(isCursor)}</span>
        <span fg={T.textDim}>{lang ?? "code"}</span>
        {annotated ? <span fg={T.accent}> ◆</span> : null}
        {block.type !== "same" ? <span fg={tagColor(block)}> [{tagLabel(block)}]</span> : null}
      </text>
      <box
        style={{
          flexDirection: "column",
          backgroundColor: T.elevated,
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
          marginLeft: 2,
        }}
      >
        {lines.map((line, li) => (
          <text key={li}>
            {line.length === 0 || (line.length === 1 && line[0]!.content === "") ? (
              " "
            ) : (
              line.map((tok, ti) => (
                <span key={ti} fg={tok.color ?? T.textMuted}>
                  {tok.content}
                </span>
              ))
            )}
          </text>
        ))}
      </box>
    </box>
  );
}

/** Vertical rhythm: gaps live ABOVE blocks so boundaries never collapse. */
function topGap(prev: DisplayBlock | undefined, cur: DisplayBlock): number {
  if (!prev) return 0;
  const tightPair =
    (cur.kind === "li" && prev.kind === "li") || (cur.kind === "oli" && prev.kind === "oli");
  return tightPair ? 0 : 1;
}

// ── the rail ──────────────────────────────────

interface CardEditState {
  id: string;
  text: string;
  onInput: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

/** The open confirm card: verdict, summary draft, counts, and its actions. */
interface SubmitConfirmState {
  verdict: VerdictKind;
  summary: string;
  annotationCount: number;
  blockingCount: number;
  onInput: (summary: string) => void;
  onSelectVerdict: (verdict: VerdictKind) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function Rail({
  session,
  selectedId,
  resolvedIds,
  railTab,
  pendingCount,
  cardEdit,
  submitConfirm,
  onTab,
  onSelectCard,
  onActivateCard,
  onSubmitRequest,
  railScrollRef,
}: {
  session: ReviewSession;
  selectedId?: string;
  /** Ids whose anchor resolved; null = orphan display off (diff view). */
  resolvedIds: Set<string> | null;
  railTab: RailTab;
  pendingCount: number;
  cardEdit: CardEditState | null;
  submitConfirm: SubmitConfirmState | null;
  onTab: (tab: RailTab) => void;
  onSelectCard: (id: string) => void;
  onActivateCard: (id: string) => void;
  onSubmitRequest: () => void;
  railScrollRef: React.RefObject<ScrollBoxRenderable | null>;
}): React.ReactNode {
  return (
    <box style={{ width: 34, backgroundColor: T.panel, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      <box style={{ height: 1, flexDirection: "row" }}>
        <box onMouseUp={() => onTab("review")}>
          <text fg={railTab === "review" ? T.accent : T.textDim}>Review ({pendingCount})</text>
        </box>
        <text fg={T.textDim}>{"   "}</text>
        <box onMouseUp={() => onTab("agent")}>
          <text fg={railTab === "agent" ? T.accent : T.textDim}>Agent</text>
        </box>
      </box>
      <text> </text>
      {railTab === "agent" ? (
        <AgentTab session={session} />
      ) : (
        <>
          {session.workingCopy !== undefined ? <text fg={T.textDim}>± plan edits → one diff</text> : null}
          {session.annotations.length === 0 ? (
            <text fg={T.textDim}>no annotations yet</text>
          ) : (
            <scrollbox ref={railScrollRef} style={{ flexGrow: 1 }} focused={false}>
              {session.annotations.map((annotation) => (
                <AnnotationCard
                  key={annotation.id}
                  kind={annotation.kind}
                  quote={annotation.anchor.quote}
                  saved={{
                    body: annotation.body,
                    selected: annotation.id === selectedId,
                    orphan: resolvedIds !== null && !resolvedIds.has(annotation.id),
                    blocking: annotationBlocking(annotation),
                    editing:
                      cardEdit && cardEdit.id === annotation.id
                        ? { text: cardEdit.text, onInput: cardEdit.onInput, onSave: cardEdit.onSave, onCancel: cardEdit.onCancel }
                        : null,
                    onMouseUp: () =>
                      annotation.id === selectedId ? onActivateCard(annotation.id) : onSelectCard(annotation.id),
                  }}
                />
              ))}
            </scrollbox>
          )}
          <box style={{ flexGrow: 1 }} />
          {/* the confirm card sits OUTSIDE the scrollbox: the annotation stack
              above scrolls while the card stays pinned to the rail bottom */}
          {session.status === "resolved" ? (
            <text fg={T.green}>resolved: {session.verdict!.kind.replace("_", " ")}</text>
          ) : submitConfirm ? (
            <SubmitConfirmCard confirm={submitConfirm} />
          ) : (
            <box onMouseUp={onSubmitRequest}>
              <text fg={T.accent}>{`Submit review (${pendingCount}) ⏎`}</text>
            </box>
          )}
        </>
      )}
    </box>
  );
}

/**
 * Confirm card content rows: counts, spacer, verdict selector, spacer,
 * summary input, spacer, Submit/Cancel buttons. The bordered box height is
 * this count plus the two border rows - a pure function of the content, so
 * layout and render never drift.
 */
const SUBMIT_CONFIRM_CONTENT_ROWS = 7;

function submitConfirmHeight(): number {
  return SUBMIT_CONFIRM_CONTENT_ROWS + 2;
}

/**
 * The Submit button expanded into a bordered confirm card at the rail bottom:
 * honest counts, the verdict selector (arrow keys or click), the optional
 * summary, and plain word-buttons - key hints live in the status line only.
 */
function SubmitConfirmCard({ confirm }: { confirm: SubmitConfirmState }): React.ReactNode {
  return (
    <box
      style={{
        height: submitConfirmHeight(),
        marginRight: 1,
        border: true,
        borderStyle: "rounded",
        borderColor: T.accent,
        backgroundColor: T.elevated,
        flexDirection: "column",
        paddingLeft: 1,
      }}
      title=" submit review "
    >
      <text fg={T.textDim}>{`${confirm.annotationCount} annotations · ${confirm.blockingCount} blocking`}</text>
      <box style={{ height: 1 }} />
      <box style={{ flexDirection: "row", height: 1 }}>
        {VERDICTS.map((candidate) => (
          <box key={candidate} style={{ paddingRight: 1 }} onMouseUp={() => confirm.onSelectVerdict(candidate)}>
            <text fg={candidate === confirm.verdict ? verdictColor(candidate) : T.textDim}>
              {candidate === confirm.verdict ? `[${VERDICT_LABEL[candidate]}]` : ` ${VERDICT_LABEL[candidate]} `}
            </text>
          </box>
        ))}
      </box>
      <box style={{ height: 1 }} />
      <input focused value={confirm.summary} onInput={confirm.onInput} placeholder="summary for the agent (optional)" />
      <box style={{ height: 1 }} />
      <box style={{ flexDirection: "row", height: 1 }}>
        <box style={{ backgroundColor: T.accent, marginRight: 2 }} onMouseUp={confirm.onSubmit}>
          <text fg={T.accentInk}> Submit </text>
        </box>
        <box onMouseUp={confirm.onCancel}>
          <text fg={T.textDim}> Cancel </text>
        </box>
      </box>
    </box>
  );
}

/** Agent tab: who submitted, where the session stands, which revision. */
function AgentTab({ session }: { session: ReviewSession }): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", flexGrow: 1 }}>
      <text fg={T.textMuted}>{session.artifact.meta.agent ?? "unknown"}</text>
      <text fg={T.textDim}>status: {session.status}</text>
      <text fg={T.textDim}>revision {session.revisions.length}</text>
    </box>
  );
}

/**
 * The composer and the rail card are one component in two modes: draft props
 * attached (bordered box inline in the document flow) or saved props attached
 * (rail card, optionally editing its body in place). Compose, saved, and
 * re-edit all share this rendering path.
 */
function AnnotationCard({
  kind,
  quote,
  draft,
  saved,
}: {
  kind: string;
  quote: string;
  draft?: { text: string; onInput: (text: string) => void; onSave: () => void; onCancel: () => void };
  saved?: {
    body: string;
    selected: boolean;
    orphan: boolean;
    blocking: boolean;
    editing: { text: string; onInput: (text: string) => void; onSave: () => void; onCancel: () => void } | null;
    onMouseUp: () => void;
  };
}): React.ReactNode {
  const color = kind === "suggestion" ? T.green : T.accent;
  if (draft) {
    const verb = kind === "suggestion" ? "suggest replacement for" : "comment on";
    return (
      <box
        style={{
          height: composeBoxHeight(),
          marginLeft: 2,
          marginRight: 2,
          border: true,
          borderStyle: "rounded",
          borderColor: color,
          backgroundColor: T.elevated,
          flexDirection: "column",
          paddingLeft: 1,
        }}
        title={` ${verb} "${truncate(quote, 40)}" `}
      >
        <input focused value={draft.text} onInput={draft.onInput} placeholder="write a note..." />
        <SaveCancelRow onSave={draft.onSave} onCancel={draft.onCancel} />
      </box>
    );
  }
  const card = saved!;
  return (
    <box
      style={{ flexDirection: "column", marginBottom: 1, backgroundColor: card.selected ? T.elevated : undefined }}
      onMouseUp={card.onMouseUp}
    >
      <text fg={card.selected ? T.text : color}>
        {card.selected ? "▸ " : "  "}
        {kind.toUpperCase()}
        {card.blocking ? <span fg={T.red}> · BLOCKING</span> : null}
        <span fg={T.textDim}>{card.orphan ? " · ORPHANED" : " · pending"}</span>
      </text>
      <text fg={T.textDim}>  "{truncate(quote, 26)}"</text>
      {card.editing ? (
        <>
          <input focused value={card.editing.text} onInput={card.editing.onInput} />
          <SaveCancelRow onSave={card.editing.onSave} onCancel={card.editing.onCancel} />
        </>
      ) : (
        <text fg={card.orphan ? T.textDim : T.textMuted}>  {truncate(card.body, 28)}</text>
      )}
    </box>
  );
}

function SaveCancelRow({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }): React.ReactNode {
  return (
    <box style={{ flexDirection: "row", height: 1 }}>
      <box style={{ backgroundColor: T.accent, marginRight: 2 }} onMouseUp={onSave}>
        <text fg={T.accentInk}> Save ⏎ </text>
      </box>
      <box onMouseUp={onCancel}>
        <text fg={T.textDim}> Cancel esc </text>
      </box>
    </box>
  );
}

/** Forward-compatible: open annotation kinds may carry a blocking flag. */
function annotationBlocking(annotation: Annotation): boolean {
  return (annotation as Annotation & { blocking?: boolean }).blocking === true;
}

function Inbox({ inbox, cursor }: { inbox: ReviewSession[]; cursor: number }): React.ReactNode {
  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%", backgroundColor: T.bg, padding: 1 }}>
      <text fg={T.accent}>cueloop · inbox ({inbox.length} pending)</text>
      <text> </text>
      {inbox.length === 0 ? (
        <text fg={T.textDim}>nothing waiting for review</text>
      ) : (
        inbox.map((s, i) => (
          <text key={s.id} fg={i === cursor ? T.text : T.textMuted} bg={i === cursor ? T.cursorBg : undefined}>
            {i === cursor ? "▸ " : "  "}
            {s.artifact.meta.title ?? s.id} · {s.workspace.branch} · {s.artifact.type}
          </text>
        ))
      )}
      <box style={{ flexGrow: 1 }} />
      <text fg={T.textDim}>j/k move · ⏎ open · q quit</text>
    </box>
  );
}

/** Bottom compose bar - the diff view still composes here. */
function ComposeBar({
  mode,
  quote,
  onChange,
}: {
  mode: Extract<Mode, { m: "compose" }>;
  quote: string;
  onChange: (text: string) => void;
}): React.ReactNode {
  return (
    <box style={{ height: 2, backgroundColor: T.elevated, flexDirection: "column", paddingLeft: 1 }}>
      <text fg={mode.kind === "suggestion" ? T.green : T.accent}>
        {mode.kind === "suggestion" ? "SUGGEST REPLACEMENT FOR" : "COMMENT ON"} “{truncate(quote, 60)}” · ⏎ save · esc cancel
      </text>
      <input focused value={mode.text} onInput={onChange} />
    </box>
  );
}

function DiffPane({
  rows,
  cursor,
  annotations,
  focusedAnn,
}: {
  rows: DiffRow[];
  cursor: number;
  annotations: Annotation[];
  focusedAnn?: string;
}): React.ReactNode {
  // simple windowing: keep the cursor in view without a scroll dependency
  const windowStart = Math.max(0, cursor - 12);
  const visible = rows.slice(windowStart, windowStart + 200);
  const annotated = new Map<number, Annotation>();
  for (const a of annotations) {
    const idx = rows.findIndex((r) => r.text === a.anchor.quote && (r.t === "ctx" || r.t === "add" || r.t === "del"));
    if (idx !== -1) annotated.set(idx, a);
  }
  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingTop: 1 }}>
      {visible.map((row, vi) => {
        const i = windowStart + vi;
        const isCursor = i === cursor;
        const ann = annotated.get(i);
        const gutter = row.t === "del" ? (row.oldLine?.toString() ?? "") : (row.newLine?.toString() ?? "");
        const sign = row.t === "add" ? "+" : row.t === "del" ? "-" : " ";
        if (row.t === "file") {
          return (
            <text key={i} fg={T.text} bg={isCursor ? T.cursorBg : T.panel}>
              {isCursor ? "▎" : " "}■ {row.text}
            </text>
          );
        }
        if (row.t === "hunk") {
          return (
            <text key={i} fg={T.blue} bg={isCursor ? T.cursorBg : undefined}>
              {isCursor ? "▎" : " "}{row.text}
            </text>
          );
        }
        const fg = row.t === "add" ? T.insFg : row.t === "del" ? T.delFg : T.textMuted;
        return (
          <box key={i} style={{ flexDirection: "column" }}>
            <text bg={isCursor ? T.cursorBg : ann ? T.markCommentBg : undefined}>
              <span fg={T.textDim}>{isCursor ? "▎" : " "}{gutter.padStart(4)} </span>
              <span fg={fg}>{sign}{row.text}</span>
            </text>
            {ann ? (
              <text>
                <span fg={T.textDim}>{"      "}</span>
                <span fg={ann.id === focusedAnn ? T.text : T.accent}>◆ {truncate(ann.body, 70)}</span>
              </text>
            ) : null}
          </box>
        );
      })}
    </box>
  );
}

function CompletionOverlay({
  verdict,
  completion,
  status,
  returnsTo,
}: {
  verdict: VerdictKind;
  completion: { phase: "prompt" } | { phase: "counting"; remaining: number };
  /** Latest status line (e.g. the vault-export path) stays visible here. */
  status: string;
  /** Where focus goes on close (the agent's herdr pane), when known. */
  returnsTo?: string;
}): React.ReactNode {
  const approved = verdict === "approve";
  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: T.bg,
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <text fg={approved ? T.green : T.accent}>{approved ? "✓ review approved" : "✎ feedback sent"}</text>
      <text> </text>
      <text fg={T.text}>The agent has your {approved ? "approval" : "feedback"} and is unblocked.</text>
      {status ? <text fg={T.textDim}>{status}</text> : null}
      <text> </text>
      {completion.phase === "counting" ? (
        <text fg={T.textDim}>
          closing in {completion.remaining}s{returnsTo ? ` - returning to ${returnsTo}` : ""} · ⏎ now · esc stay
        </text>
      ) : (
        <text fg={T.textDim}>⏎ close · a always close after submit (3s) · esc stay</text>
      )}
    </box>
  );
}

// ── small helpers ─────────────────────────────

function marker(d: DisplayBlock): string {
  if (d.kind === "li") return "- ";
  if (d.kind === "oli") return `${d.oliNum ?? 1}. `;
  if (d.kind === "quote") return "▏ ";
  return "";
}

function cursorGlyph(isCursor: boolean): string {
  return isCursor ? "▎ " : "  ";
}

function tagLabel(d: DisplayBlock): string {
  return d.type === "del" ? "cut" : d.type === "add" ? "new" : "edited";
}

function tagColor(d: DisplayBlock): string {
  return d.type === "del" ? T.red : d.type === "add" ? T.green : T.accent;
}

function verdictColor(v: VerdictKind): string {
  return v === "approve" ? T.green : v === "request_changes" ? T.red : T.blue;
}

function defaultVerdict(s: ReviewSession): VerdictKind {
  return s.annotations.length || s.workingCopy !== undefined ? "request_changes" : "approve";
}

function runStyle(r: StyleRun, d: DisplayBlock): { fg?: string; bg?: string; attributes?: number } {
  const headingFg = d.kind === "h1" ? T.text : d.kind === "h2" || d.kind === "h3" ? T.accent : undefined;
  const struck = d.type === "del";
  switch (r.role) {
    case "ins":
      return { fg: T.insFg };
    case "del":
      return { fg: T.delFg };
    case "mark-comment":
      return { fg: T.text, bg: T.markCommentBg };
    case "mark-suggestion":
      return { fg: T.text, bg: T.markSuggestionBg };
    case "mark-focus":
      return { fg: T.accentInk, bg: T.accent };
    case "kspan":
      return { fg: T.accentInk, bg: T.accent };
    default:
      return { fg: struck ? T.red : (headingFg ?? (d.kind === "code" ? T.textMuted : T.text)) };
  }
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\n/g, " ");
  return one.length > n ? one.slice(0, n - 1) + "…" : one;
}
